/**
 * 翻訳 API のコントローラーです。
 *
 * 役割は 2 つです。
 *
 * 1. 翻訳サービス（translation-service コンテナ）への認証済み中継。
 *    JSON API は proxy()、SSE ストリームは streamTranslation() で流します。
 *    ブラウザー側の接続が切れた場合は AbortController で LLM まで停止要求を
 *    伝播させ、途中の翻訳結果が適用されないようにします。
 * 2. 英語版 .en.tex 文書の保存。Overleaf 本体の EditorController を使い、
 *    通常の編集操作と同じ経路でドキュメントを追加・更新します。
 *    場所の変更や同名ファイル衝突などの競合は、日本語の案内付き 409 で返します。
 */

import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import {
  parseReq,
  z,
  zz,
} from '../../../../app/src/infrastructure/Validation.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'

// 翻訳サービスの内部 URL。Compose ネットワーク名で解決されるため、ホストへは公開しません。
const serviceUrl = (
  process.env.LOCAL_LLM_SERVICE_URL || 'http://translation-service:8000'
).replace(/\/$/, '')

// ---- リクエスト検証スキーマ（Overleaf 公式の Validation.mjs 準拠） ----------

const projectParams = z.strictObject({
  Project_id: zz.objectId(),
})
const projectOnlySchema = z.object({
  params: projectParams,
})
const translateSchema = z.object({
  params: projectParams,
  body: z.strictObject({
    // 原文テキストと任意の使用モデル指定。上限は翻訳サービスの設定と揃えます。
    text: z.string().min(1).max(500000),
    model: z.string().max(256).nullable().optional(),
  }),
})
const settingsSchema = z.object({
  params: projectParams,
  body: z.strictObject({
    terms: z
      .array(
        z.strictObject({
          source: z.string().max(160),
          target: z.string().max(200),
        })
      )
      .max(200),
    model: z.string().max(256).nullable().optional(),
    context: z.string().max(4000).optional(),
    prompt_instructions: z.string().max(4000).optional(),
    endpoint_id: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .nullable()
      .optional(),
  }),
})
// 翻訳エンドポイントの保存 body（キーの空文字は作成時「なし」・更新時「変更なし」）。
const endpointSchema = z.object({
  body: z.strictObject({
    name: z.string().min(1).max(100),
    base_url: z.string().min(1).max(500),
    api_key: z.string().max(500).optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
    set_default: z.boolean().optional(),
    clear_api_key: z.boolean().optional(),
    minimal_prompt: z.boolean().optional(),
    chunk_chars: z.number().int().min(200).max(200000).nullable().optional(),
  }),
})
const endpointParamsSchema = z.object({
  params: z.strictObject({ Endpoint_id: z.string().regex(/^[a-f0-9]{16}$/) }),
})
const modelsSchema = z.object({
  query: z.object({
    endpoint_id: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
  }),
})
const endpointTestSchema = z.object({
  body: z.strictObject({
    base_url: z.string().min(1).max(500),
    api_key: z.string().max(500).optional(),
    endpoint_id: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    clear_api_key: z.boolean().optional(),
  }),
})
const englishDocumentSchema = z.object({
  params: projectParams,
  body: z.strictObject({
    source_doc_id: zz.objectId(),
    parent_folder_id: zz.objectId(),
    name: z.string().min(1).max(255),
    content: z.string().max(500000),
    overwrite: z.boolean(),
  }),
})

// ---- 翻訳サービスへの JSON 中継 --------------------------------------------

/**
 * 翻訳サービスの JSON API へリクエストを転送し、応答をそのまま中継します。
 * 翻訳サービスが停止していても Overleaf 本体は動くため、接続失敗は 503 と
 * 案内文で返し、エラーページやクラッシュにはしません。
 */
async function proxy(req, res, { path, method = 'GET', body, projectId }) {
  try {
    const response = await fetch(`${serviceUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = await response
      .json()
      .catch(() => ({ detail: 'Invalid translation service response' }))
    if (!response.ok) {
      logger.warn(
        { projectId, status: response.status },
        'local LLM translation service returned an error'
      )
    }
    return res.status(response.status).json(payload)
  } catch (error) {
    logger.warn(
      { projectId, err: error },
      'local LLM translation service is unavailable'
    )
    return res.status(503).json({
      detail:
        'Translation service is unavailable. Overleaf remains available; check the translation-service container and LOCAL_LLM_BASE_URL.',
    })
  }
}

// ---- SSE ストリームの中継 ----------------------------------------------------

/**
 * res.write が詰返した（内部バッファが満杯の）とき、書き戻せるまで待ちます。
 * disconnect で終わるため、クライアント切断でもブロックしません。
 */
function waitForWritable(res) {
  if (res.destroyed || res.writableEnded) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      res.off('drain', finish)
      res.off('close', finish)
      res.off('error', finish)
      resolve()
    }
    res.once('drain', finish)
    res.once('close', finish)
    res.once('error', finish)
  })
}

/**
 * 翻訳 SSE ストリームを翻訳サービスからブラウザーへ中継します。
 *
 * ブラウザーがタブを閉じる・停止を押すなどして接続が切れた場合は
 * AbortController で翻訳サービス（→LLM）側のリクエストも中止し、
 * 途中結果が確定・保存されないようにします。
 */
async function streamTranslation(req, res, { path, body, projectId }) {
  const abortController = new AbortController()
  const abortOnDisconnect = () => {
    if (!res.writableEnded) abortController.abort()
  }
  res.once('close', abortOnDisconnect)

  try {
    const response = await fetch(`${serviceUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    })

    if (!response.ok) {
      // ストリーム開始前のエラー（検証失敗・モデル未選択など）は JSON で返します。
      const payload = await response
        .json()
        .catch(() => ({ detail: 'Invalid translation service response' }))
      logger.warn(
        { projectId, status: response.status },
        'local LLM translation service returned an error'
      )
      return res.status(response.status).json(payload)
    }
    if (!response.body) {
      throw new Error('Translation service returned an empty response stream')
    }

    // SSE ヘッダーを送り、以降は受信片を待ってそのまま書き出します。
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()

    for await (const chunk of response.body) {
      if (res.destroyed) {
        // ブラウザー切断を検知したら、上流（翻訳サービス）側も止めます。
        abortController.abort()
        return
      }
      if (!res.write(Buffer.from(chunk))) await waitForWritable(res)
    }
    if (!res.destroyed) res.end()
  } catch (error) {
    if (abortController.signal.aborted || res.destroyed) return
    logger.warn(
      { projectId, err: error },
      'local LLM translation stream failed'
    )
    if (res.headersSent) {
      // ストリーム開始後の障害は、HTTP コードではなく SSE の error イベントで伝えます。
      res.write(
        `data: ${JSON.stringify({ type: 'error', detail: 'Translation stream interrupted. Check the service logs and retry.' })}\n\n`
      )
      return res.end()
    }
    return res.status(503).json({
      detail:
        'Translation service is unavailable. Overleaf remains available; check the translation-service container and LOCAL_LLM_BASE_URL.',
    })
  } finally {
    // ハンドラ終了時に未発生の中止があれば必ず起こし、上流リークを防ぎます。
    res.off('close', abortOnDisconnect)
    if (!abortController.signal.aborted) abortController.abort()
  }
}

// ---- API ハンドラ -------------------------------------------------------------

export default {
  /** 管理画面用のリダイレクトを使わず、API の権限拒否を JSON の 403 で返します。 */
  requireSiteAdmin: expressify(async (req, res, next) => {
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!(await AuthorizationManager.promises.isUserSiteAdmin(userId))) {
      return res
        .status(403)
        .json({ detail: '接続先の管理にはサイト管理者権限が必要です。' })
    }
    next()
  }),

  /** 翻訳サービスのモデル一覧をそのまま返します。 */
  getModels: expressify(async (req, res) => {
    const { query } = parseReq(req, modelsSchema)
    const path = query.endpoint_id
      ? `/models?endpoint_id=${encodeURIComponent(query.endpoint_id)}`
      : '/models'
    return proxy(req, res, { path })
  }),

  /** 翻訳エンドポイントの一覧を返します。 */
  getEndpoints: expressify(async (req, res) => {
    return proxy(req, res, { path: '/endpoints' })
  }),

  /** 翻訳エンドポイントを 1 件追加します。 */
  createEndpoint: expressify(async (req, res) => {
    const { body } = parseReq(req, endpointSchema)
    return proxy(req, res, { path: '/endpoints', method: 'POST', body })
  }),

  /** 翻訳エンドポイントを 1 件更新します。 */
  updateEndpoint: expressify(async (req, res) => {
    const { params, body } = parseReq(
      req,
      z.object({
        params: endpointParamsSchema.shape.params,
        body: endpointSchema.shape.body,
      })
    )
    return proxy(req, res, {
      path: `/endpoints/${params.Endpoint_id}`,
      method: 'PUT',
      body,
    })
  }),

  /** 翻訳エンドポイントを 1 件削除します。 */
  deleteEndpoint: expressify(async (req, res) => {
    const { params } = parseReq(req, endpointParamsSchema)
    return proxy(req, res, {
      path: `/endpoints/${params.Endpoint_id}`,
      method: 'DELETE',
    })
  }),

  /** 翻訳エンドポイントを標準に設定します。 */
  setEndpointDefault: expressify(async (req, res) => {
    const { params } = parseReq(req, endpointParamsSchema)
    return proxy(req, res, {
      path: `/endpoints/${params.Endpoint_id}/default`,
      method: 'POST',
    })
  }),

  /** 標準エンドポイント指定を解除します。 */
  clearEndpointDefault: expressify(async (req, res) => {
    return proxy(req, res, { path: '/endpoints/default/clear', method: 'POST' })
  }),

  /** 保存せずに接続を確認します。保存済みキーの利用判断は翻訳サービスが行います。 */
  testEndpoint: expressify(async (req, res) => {
    const { body } = parseReq(req, endpointTestSchema)
    return proxy(req, res, { path: '/endpoints/test', method: 'POST', body })
  }),

  /** プロジェクトの翻訳設定を取得します。 */
  getSettings: expressify(async (req, res) => {
    const { params } = parseReq(req, projectOnlySchema)
    return proxy(req, res, {
      path: `/projects/${params.Project_id}/settings`,
      projectId: params.Project_id,
    })
  }),

  /** プロジェクトの翻訳設定を保存します。 */
  putSettings: expressify(async (req, res) => {
    const { params, body } = parseReq(req, settingsSchema)
    return proxy(req, res, {
      path: `/projects/${params.Project_id}/settings`,
      projectId: params.Project_id,
      method: 'PUT',
      body,
    })
  }),

  /** 翻訳を開始し、SSE を中継します。 */
  translate: expressify(async (req, res) => {
    const { params, body } = parseReq(req, translateSchema)
    return streamTranslation(req, res, {
      path: `/projects/${params.Project_id}/translate`,
      projectId: params.Project_id,
      body,
    })
  }),

  /**
   * 翻訳結果を英語版 .en.tex として保存します。
   *
   * 「main.tex → main.en.tex」という命名規則をサーバー側でも強制し、
   * 翻訳中にファイル移動・改名があった場合は 409 で保存を止めます。
   * 日本語原文には一切触れません。
   */
  saveEnglishDocument: expressify(async (req, res) => {
    // 新設 API は検証失敗を拒否します。ログだけで不正入力を通しません。
    const { params, body } = parseReq(req, englishDocumentSchema)
    const project = await ProjectGetter.promises.getProject(params.Project_id, {
      rootFolder: true,
    })
    if (!project) {
      return res.sendStatus(404)
    }

    // 翻訳元ドキュメントの現在位置を検証し、要求内容と食い違っていれば拒否します。
    const { element: sourceDoc, folder } =
      await ProjectLocator.promises.findElement({
        project,
        element_id: body.source_doc_id,
        type: 'doc',
      })
    const sourceName = sourceDoc.name
    if (
      !sourceName.toLowerCase().endsWith('.tex') ||
      sourceName.toLowerCase().endsWith('.en.tex')
    ) {
      return res.status(400).json({
        detail: '日本語版の .tex ファイルを翻訳元として指定してください。',
      })
    }
    const englishName = `${sourceName.slice(0, -4)}.en.tex`
    if (
      folder._id.toString() !== body.parent_folder_id.toString() ||
      body.name !== englishName
    ) {
      return res.status(409).json({
        detail:
          '翻訳元ファイルの場所が変わりました。ファイルツリーを更新して再度保存してください。',
      })
    }
    // 英語版名の衝突を種類ごとに確認します（ファイル・フォルダー同名は作成不可）。
    const existingDoc = folder.docs.find((doc) => doc.name === englishName)
    const existingFile = folder.fileRefs.find(
      (file) => file.name === englishName
    )
    const existingFolder = folder.folders.find(
      (candidate) => candidate.name === englishName
    )
    if (existingFile) {
      return res.status(409).json({
        detail: `${englishName} と同名の通常ファイルがあるため、英語版文書として保存できません。`,
      })
    }
    if (existingFolder) {
      return res.status(409).json({
        detail: `${englishName} と同名のフォルダーがあるため、英語版文書として保存できません。`,
      })
    }
    if (existingDoc && !body.overwrite) {
      return res.status(409).json({
        detail:
          '英語版文書が既にあります。上書きを確認してから再実行してください。',
      })
    }
    if (!existingDoc && body.overwrite) {
      return res.status(409).json({
        detail:
          '上書き対象の英語版文書が見つかりません。もう一度保存してください。',
      })
    }

    // 実際の保存は Overleaf 本体の通常経路（addDoc / upsertDoc）を通すため、
    // リアルタイム同期・履歴・ファイルツリー更新が正しく働きます。
    const userId = SessionManager.getLoggedInUserId(req.session)
    const contentLines = body.content.split('\n')
    let doc
    if (existingDoc) {
      doc = await EditorController.promises.upsertDoc(
        params.Project_id,
        folder._id,
        englishName,
        contentLines,
        'local-llm-translation',
        userId
      )
    } else {
      doc = await EditorController.promises.addDoc(
        params.Project_id,
        folder._id,
        englishName,
        contentLines,
        'local-llm-translation',
        userId
      )
    }
    return res.json({ doc, name: englishName })
  }),
}
