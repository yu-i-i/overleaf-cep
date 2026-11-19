// 保存済みのTeX等から質問に合う参照を収集し、文字数の予算内へ切り詰めます。
// 送信できた本文だけを参照ファイル一覧へ載せ、未送信ファイルを読んだと表示しません。

/*
 * LLMProjectContext - AI Assistant チャット用のプロジェクト TeX 自動参照です
 * （2026-11-13 の運用者要望: VS Code Copilot の @workspace のように、質問する
 * だけでプロジェクトの LaTeX  source を自動で参照させてほしい）。
 *
 * 方式（軽量キーワード参照。埋め込みモデルは使いません）:
 *   1. docstore の全ドキュメント（docstore 最新版 = メインエディターと同一）を
 *      読み、拡張子 .tex / .bib / .sty / .cls を候補にします。
 *   2. 質問文から単語（欧文 3 文字以上）と日本語バイグラムを取り出し、各ファイルの
 *      出現回数でスコアリングします。
 *   3. 「編集中のファイルの冒頭」+「スコア上位ファイルの一致付近の抜粋」を、
 *      合計予算内に収まるよう切り詰めて 1 つの参照ブロックに整形します。
 *
 * 注意: 参照内容は「読み取りデータ」であり指示として扱わないよう、チャット側で
 * 注記を添えて system メッセージに添付します。LLM 呼び出しは行いません。
 */

import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import logger from '@overleaf/logger'
import { fitContextBlocks } from './LLMContextBudget.mjs'

// 参照候補にする拡張子（LaTeX プロジェクト本体）。
const SOURCE_EXT_RE = /\.(tex|bib|sty|cls)$/i
// 予算（文字数）。合計を超えたら下位の抜粋から削ります（ユーザー設定で変更可・
// 2026-11-13。設定値 0 のときの組み込み既定です）。
const FILE_LIST_BUDGET = 1500
const CURRENT_FILE_BUDGET = 3500
const MATCH_WINDOW = 900
const MAX_MATCH_FILES = 3
const TOTAL_BUDGET = 12000
const FULL_DEFAULT_BUDGET = 60000
const MAX_DOC_CHARS = 200000

// ---- 質問意図の自動判定（2026-11-13 の運用者要望: 「全体をチェックして」と
// 聞かれたら全体を、「ここの表現は?」と聞かれたらその周辺を、設定切り替えなしで
// 自動で選ぶ）。キーワードヒューリスティックで、LLM は使いません。 ----

// 全体チェック系と読むキーワード。質問に 1 つでも出たら全体読み込みへ昇格。
const WHOLE_INTENT_RE =
  /(全体|すべて|全て|全部|通し|通読|通して|表記ゆれ|表記のゆれ|よれ|一貫性|整合性|抜け漏れ|抜け・漏れ|構成|アウトライン|構造チェック|ダブルチェック|再チェック|最終確認|最終チェック|ファイナルチェック|校正|添削|クロスカット|論文チェック|原稿チェック|この論文を|この原稿を|このプロジェクトを|whole|entire|everything|all (files|sections|the project)|across the (project|paper|manuscript)|proofread|full review|consistency)/i

// 「特定の箇所」の示唆その 1: セクション名の語彙。質問に出ていたらその見出し付近を探す。
const SECTION_WORDS = [
  'abstract',
  ' introduction ',
  'background',
  'related work',
  'method',
  'experiment',
  'result',
  'discussion',
  'conclusion',
  'appendix',
  'reference',
  '抽象',
  '要旨',
  '概要',
  'はじめに',
  '序論',
  '序章',
  '導入',
  '背景',
  '先行研究',
  '関連研究',
  '関連作業',
  '理論',
  '方法',
  '手法',
  '実験',
  '設定',
  'データ',
  '結果',
  '考察',
  '議論',
  '限界',
  '結論',
  '示唆',
  '今後の課題',
  '謝辞',
  '付録',
  '参考文献',
]

// 「特定の箇所」の示唆その 2: 質問中にファイル名（例: main.tex, intro, refs.bib）が
// 出ていたら、そのファイルを重点収録する。
const SECTION_WINDOW = 2600
const MAX_SECTION_BLOCKS = 2
const FOCUS_FILE_RATIO = 0.45 // 1 ファイルに許す予算割合
const FOCUS_TOTAL_RATIO = 0.7 // 重点収録ファイル合計の予算割合上限

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 質問にセクション系の語が含まれていれば其の語を返す（多くとも 2 つまで）。 */
function matchedSectionWords(question) {
  const q = String(question || '').toLowerCase()
  if (!q.trim()) return []
  return SECTION_WORDS.filter(w => q.includes(w)).slice(0, 2)
}

/**
 * 質問言及ファイルの検出。'methods.tex' のような完全名、または 'intro' のように
 * 語境界付きで stem（拡張子抜き・4 文字以上）が一致するものを挙げる。
 * （誤爆を防ぐため英語 stem は前後が英数字でない位置で出現したものだけ許可）
 */
function detectFocusFiles(question, docs, current) {
  const q = String(question || '').toLowerCase()
  if (!q.trim()) return []
  const qualified = docs.filter(doc => {
    const path = doc.path.replace(/^\//, '').toLowerCase()
    return path.includes('/') && q.includes(path)
  })
  if (qualified.length)
    return qualified.sort((a, b) => b.path.length - a.path.length).slice(0, 2)
  const hits = []
  for (const doc of docs) {
    const base = doc.path.split('/').pop().toLowerCase()
    const stem = base.replace(/\.[a-z]+$/i, '')
    const fullHit = base.length >= 5 && q.includes(base)
    const stemHit =
      stem.length >= 4 &&
      new RegExp(
        `(^|[^a-z0-9_\\-])${escapeRe(stem)}(\\.(tex|bib|sty|cls))?([^a-z0-9_\\-]|$)`,
        'i'
      ).test(q)
    if (fullHit || stemHit) hits.push(doc)
  }
  // 名前の長い（=_specific な）ファイルを優先。
  return hits
    .sort((a, b) =>
      a === current ? -1 : b === current ? 1 : b.path.length - a.path.length
    )
    .slice(0, 2)
}

/**
 * セクション語の見出し（\section{...} 等）を優先しつつ、無ければ本文の初出位置を
 * 返す。検索順は 編集中ファイル → main*.tex → その他。
 * 返り値 [{ doc, at, word }]（ファイル重複は最初の 1 件のみ）。
 */
function detectSectionHits(question, docs, current) {
  const words = matchedSectionWords(question)
  if (!words.length) return []
  const rank = d =>
    d === current ? 0 : /(^|\/)main[^/]*\.tex$/i.test(d.path) ? 1 : 2
  const ordered = [...docs].sort((a, b) => rank(a) - rank(b))
  const hits = []
  const seen = new Set()
  for (const word of words) {
    if (hits.length >= MAX_SECTION_BLOCKS) break
    let found = null
    for (const doc of ordered) {
      if (seen.has(doc.path)) continue
      const headingRe = new RegExp(
        `\\\\(?:chapter|section|subsection|subsubsection)\\s*\\{[^}]*${escapeRe(word.trim())}[^}]*\\}`,
        'i'
      )
      const m = doc.text.match(headingRe)
      if (m && m.index !== undefined) {
        found = { doc, at: m.index, word }
        break
      }
      const at = doc.text.toLowerCase().indexOf(word)
      if (at !== -1 && !found) found = { doc, at, word }
    }
    if (found) {
      hits.push(found)
      seen.add(found.doc.path)
    }
  }
  return hits
}

/** 抜粋開始を行頭に揃え、char 位置から前方 window 文字（見出し本文は前方が本体なので）。 */
function excerptForward(text, at, windowSize) {
  if (!text) return ''
  let start = Math.max(0, at - 120)
  const nl = text.lastIndexOf('\n', start)
  if (nl !== -1) start = nl + 1
  return text.slice(start, Math.min(text.length, start + windowSize))
}

/** 質問文から検索語を作る（欧文単語 + 日本語/全角文字のバイグラム）。 */
export function questionTokens(question) {
  const text = String(question || '')
  const tokens = new Set()
  for (const match of text.matchAll(/[A-Za-z0-9_\-\\]{3,}/g)) {
    const word = match[0].toLowerCase()
    tokens.add(word)
    // \cite のようなコマンド参照は素の語でも探す。
    if (word.startsWith('\\')) tokens.add(word.slice(1))
  }
  for (const match of text.matchAll(
    /[\u3000-\u30ff\u3400-\u9fff\uff66-\uff9f]{2,}/g
  )) {
    const run = match[0]
    if (run.length === 2) tokens.add(run)
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2))
  }
  // 1 文字の語・頻出すぎる日本語機能語はノイズなので除く。
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'from',
    'それ',
    'この',
    'その',
    'です',
    'ます',
    'して',
    'した',
    'いる',
    'ある',
    'もの',
    'ため',
    'どれ',
    'どんな',
  ])
  return [...tokens].filter(t => t.length >= 2 && !stop.has(t))
}

/** 1 ファイルにつき 1 語 10 回を上限に、検索語の出現回数を数える。
 *  返す bestAt は最多ヒット語の最初の出現位置（抜粋窓の中心に使う）。 */
function scoreDocument(text, tokens) {
  const lower = text.toLowerCase()
  let score = 0
  let bestCount = 0
  let bestAt = -1
  for (const token of tokens) {
    let count = 0
    let at = lower.indexOf(token)
    const firstAt = at
    while (at !== -1 && count < 10) {
      count++
      at = lower.indexOf(token, at + token.length)
    }
    if (count > 0) {
      score += count
      if (count > bestCount) {
        bestCount = count
        bestAt = firstAt
      }
    }
  }
  return { score, bestAt }
}

/** 抜粋開始を行頭に揃え、char 位置を中心に window 文字分切り出す。 */
function excerptAround(text, center, windowSize) {
  if (!text) return ''
  if (text.length <= windowSize) return text
  let start = Math.max(0, center - Math.floor(windowSize / 2))
  const nl = text.indexOf('\n', start)
  if (nl !== -1 && nl - start < 120) start = nl + 1
  return text.slice(start, Math.min(text.length, start + windowSize))
}

/**
 * 'full' モード: プロジェクト全体を予算内でまとめて添える（全体チェック用）。
 * 順序は 編集中ファイル → main*.tex → パス名順。予算に達した残りは
 * 「省略」一覧として明示し、モデルに不足を分からせます。
 */
function buildFullContext(docs, current, budget) {
  const rank = d =>
    d === current ? 0 : /(^|\/)main[^/]*\.tex$/i.test(d.path) ? 1 : 2
  const ordered = [...docs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === rank(b) ? a.path.localeCompare(b.path) : 0)
  )
  const parts = []
  const usedFiles = []
  const skipped = []
  let size = 0
  for (const doc of ordered) {
    const header = `【ファイル: ${doc.path}】\n`
    if (size + header.length + 200 > budget) {
      skipped.push(doc.path)
      continue
    }
    let text = doc.text
    if (size + header.length + text.length > budget) {
      text = `${text.slice(0, budget - size - header.length - 40)}\n…（予算によりここで切断）`
    }
    const block = header + text
    parts.push(block)
    usedFiles.push(doc.path)
    size += block.length + 2
    if (size >= budget) {
      // まだ未収録のファイルは省略一覧へ回す。
      const remaining = ordered.slice(ordered.indexOf(doc) + 1).map(d => d.path)
      skipped.push(...remaining)
      break
    }
  }
  if (skipped.length) {
    parts.push(
      `【省略したファイル（予算超過）】${skipped.join(', ')}\nこれらを含めた回答はできません。必要なら対象を絞って再度質問してください。`
    )
  }
  return { context: parts.join('\n\n').slice(0, budget), files: usedFiles }
}

/**
 * 質問と編集中ファイルから参照ブロックを組み立てる。
 * options = { mode: 'auto'|'full', budgetChars: number }（2026-11-13 の追加要望:
 *  コンテキスト長はユーザー設定、full は全体読み込み）。
 * 'auto' でも質問文を見て実効モードを自動で切り替える（2026-11-13 の追加要望:
 *  全体チェック系の質問なら full に昇格、特定ファイル/箇所の言及ならその周辺を重点収録）。
 * 返り値 { context: string, files: string[], scope: string }（context 空 = 参照なし、
 *  scope = 'full-setting'|'full-intent'|'focused'|'excerpt'）。
 */
export async function buildProjectContext(
  projectId,
  question,
  currentFile,
  options = {}
) {
  const userMode = options.mode === 'full' ? 'full' : 'auto'
  // auto モードでも質問の意図を見て全体読み込みへ昇格する。
  const wholeIntent =
    userMode === 'auto' && WHOLE_INTENT_RE.test(String(question || ''))
  const mode = userMode === 'full' || wholeIntent ? 'full' : 'auto'
  const budget =
    Number.isFinite(options.budgetChars) && options.budgetChars >= 2000
      ? Math.min(200000, Math.floor(options.budgetChars))
      : mode === 'full'
        ? FULL_DEFAULT_BUDGET
        : TOTAL_BUDGET
  const docsByPath = await ProjectEntityHandler.promises.getAllDocs(projectId)
  const docs = []
  for (const [rawPath, value] of Object.entries(docsByPath || {})) {
    if (!value || !SOURCE_EXT_RE.test(rawPath)) continue
    const source = (value.lines || []).join('\n')
    const text = source.slice(0, MAX_DOC_CHARS)
    if (text.trim())
      docs.push({
        path: rawPath,
        text:
          text +
          (source.length > MAX_DOC_CHARS
            ? '\n…（ファイル長の上限により省略）'
            : ''),
      })
  }
  if (!docs.length) return { context: '', files: [], scope: 'excerpt' }

  const norm = p =>
    String(p || '')
      .replace(/^\//, '')
      .replace(/^\.\//, '')
  const target = norm(currentFile || '')
  const basenameMatches =
    target && !target.includes('/')
      ? docs.filter(d => norm(d.path).split('/').pop() === target)
      : []
  const current =
    docs.find(d => norm(d.path) === target) ||
    (basenameMatches.length === 1 ? basenameMatches[0] : null)

  if (mode === 'full') {
    const built = buildFullContext(docs, current, budget)
    return {
      ...built,
      scope: userMode === 'full' ? 'full-setting' : 'full-intent',
    }
  }

  // ---- auto: 質問中のファイル名・セクション名を先に拾う（特定箇所の言及） ----
  const focusDocs = detectFocusFiles(question, docs, current)
  const sectionHits = detectSectionHits(question, docs, current).filter(
    h => !focusDocs.includes(h.doc)
  )
  const included = new Set([
    ...focusDocs.map(d => d.path),
    ...sectionHits.map(h => h.doc.path),
  ])

  // スコアリング（編集中ファイルと重点収録済みは除外）。
  const tokens = questionTokens(question)
  const scored = docs
    .filter(d => d !== current && !included.has(d.path))
    .map(d => {
      const { score, bestAt } = scoreDocument(d.text, tokens)
      // ファイル名自体にヒットしたら加点（例: 「intro の表現は?」）。
      const nameHit = tokens.some(t => norm(d.path).toLowerCase().includes(t))
        ? 5
        : 0
      return { ...d, score: score + nameHit, bestAt }
    })
    .sort((a, b) => b.score - a.score)

  const parts = []
  const usedFiles = []
  const fileList = docs
    .slice(0, 200)
    .map(d => d.path)
    .join(', ')
  parts.push(`【ファイル一覧】${fileList.slice(0, FILE_LIST_BUDGET)}`)

  // 質問に名指しされたファイルは全文寄り（予算の範囲内）で優先収録する。
  let focusUsed = 0
  const focusCap = Math.floor(budget * FOCUS_TOTAL_RATIO)
  for (const doc of focusDocs) {
    if (focusUsed >= focusCap) break
    const perFile = Math.floor(budget * FOCUS_FILE_RATIO)
    let text = doc.text
    let note = ''
    if (text.length > Math.min(perFile, focusCap - focusUsed)) {
      text = `${text.slice(0, Math.min(perFile, focusCap - focusUsed))}\n…（以降省略）`
      note = '（予算により冒頭以降省略）'
    }
    parts.push(`【質問で言及されたファイル: ${doc.path}${note}】\n${text}`)
    usedFiles.push(doc.path)
    focusUsed += text.length
  }

  if (current && !focusDocs.includes(current)) {
    // 編集中ファイルは全体の予算に応じて上限を絞る（小さな予算でも他が載るように）。
    const currentBudget = Math.max(
      600,
      Math.min(CURRENT_FILE_BUDGET, Math.floor(budget * 0.55))
    )
    const head = current.text.slice(0, currentBudget)
    const more = current.text.length > currentBudget ? '\n…（以降省略）' : ''
    parts.push(`【編集中のファイル: ${current.path}】\n${head}${more}`)
    usedFiles.push(current.path)
  }

  let remaining = budget - parts.join('\n\n').length
  let taken = 0

  // 質問にセクション名（例: 「考察」「method」）が出ていたら、その見出し付近を
  // 広めの窓で前方収録する（本文は前方に続くため）。
  for (const hit of sectionHits) {
    if (remaining < 800) break
    const windowSize = Math.min(SECTION_WINDOW, remaining - 120)
    const excerpt = excerptForward(hit.doc.text, hit.at, windowSize)
    const block = `【質問で触れられた箇所: ${hit.doc.path}「${hit.word.trim()}」付近】\n${excerpt}`
    parts.push(block)
    usedFiles.push(hit.doc.path)
    remaining -= block.length
  }

  for (const doc of scored) {
    if (taken >= MAX_MATCH_FILES || remaining < 600) break
    if (doc.score <= 0) break
    const windowSize = Math.min(MATCH_WINDOW, remaining - 120)
    const excerpt = excerptAround(
      doc.text,
      doc.bestAt >= 0 ? doc.bestAt : 0,
      windowSize
    )
    const block = `【関連ファイル: ${doc.path}（一致付近の抜粋）】\n${excerpt}`
    parts.push(block)
    usedFiles.push(doc.path)
    remaining -= block.length
    taken++
  }

  // 一致ゼロでも「プロジェクトはどんな構成?」系の質問には主要ファイルの冒頭が役立つ
  // ため、編集中ファイルも無いときは先頭ファイルの冒頭を添える。
  if (taken === 0 && !current && !focusDocs.length && docs[0]) {
    parts.push(
      `【先頭ファイル: ${docs[0].path}】\n${docs[0].text.slice(0, 1500)}…（以降省略）`
    )
    usedFiles.push(docs[0].path)
  }

  logger.debug?.(
    { projectId, files: usedFiles.length },
    '[LLM] project context built'
  )
  const scope = focusDocs.length || sectionHits.length ? 'focused' : 'excerpt'
  return { ...fitContextBlocks(parts, usedFiles, budget), scope }
}
