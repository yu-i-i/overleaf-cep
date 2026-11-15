import { useEffect, useState } from 'react'
import {
  getJSON,
  postJSON,
  putJSON,
  deleteJSON,
} from '@/infrastructure/fetch-json'
import { useUserContext } from '@/shared/context/user-context'

type Endpoint = {
  id: string
  name: string
  base_url: string
  has_api_key: boolean
  is_default: boolean
  extra_params: Record<string, unknown>
  minimal_prompt: boolean
  chunk_chars: number | null
}

type Props = {
  endpointId: string | null
  disabled: boolean
  onSelect: (id: string | null) => void
  onChanged: () => void
}

/** 接続先は共有し、選択はプロジェクトごとに行います。キーは読み戻しません。 */
export default function ConnectionSettings({
  endpointId,
  disabled,
  onSelect,
  onChanged,
}: Props) {
  const user = useUserContext()
  const canManage = user.isAdmin === true
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [editing, setEditing] = useState<Endpoint | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [extra, setExtra] = useState('{}')
  const [minimal, setMinimal] = useState(false)
  const [chunkChars, setChunkChars] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    const result = await getJSON<{ data: Endpoint[] }>('/local-llm/endpoints')
    setEndpoints(result.data)
  }

  useEffect(() => {
    // 閉じたパネルの要求が、次に開いたパネルの状態へ反映されるのを防ぎます。
    let active = true
    getJSON<{ data: Endpoint[] }>('/local-llm/endpoints')
      .then((result) => {
        if (active) setEndpoints(result.data)
      })
      .catch(() => {
        if (active) setError('接続先一覧を読み込めませんでした。')
      })
    return () => {
      active = false
    }
  }, [])

  const edit = (endpoint: Endpoint | null) => {
    setEditing(endpoint)
    setName(endpoint?.name || '')
    setUrl(endpoint?.base_url || '')
    // 保存済みキーは有無だけを表示し、入力欄へ埋め戻しません。
    setKey('')
    setClearKey(false)
    setExtra(JSON.stringify(endpoint?.extra_params || {}, null, 2))
    setMinimal(endpoint?.minimal_prompt || false)
    setChunkChars(endpoint?.chunk_chars?.toString() || '')
    setMakeDefault(false)
    setError('')
    setNotice('')
  }

  const run = async (operation: () => Promise<void>) => {
    setPending(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (failure) {
      const detail = failure as { data?: { detail?: string }; message?: string }
      setError(
        detail.data?.detail ||
          detail.message ||
          '接続設定の操作に失敗しました。'
      )
    } finally {
      setPending(false)
    }
  }

  const save = () =>
    run(async () => {
      const parameters: unknown = JSON.parse(extra)
      if (
        !parameters ||
        Array.isArray(parameters) ||
        typeof parameters !== 'object'
      ) {
        throw new Error(
          '追加パラメータは JSON オブジェクトで指定してください。'
        )
      }
      const body = {
        name: name.trim(),
        base_url: url.trim(),
        api_key: key,
        clear_api_key: clearKey,
        extra_params: parameters,
        minimal_prompt: minimal,
        chunk_chars: chunkChars ? Number(chunkChars) : null,
        set_default: makeDefault,
      }
      if (editing) await putJSON(`/local-llm/endpoints/${editing.id}`, { body })
      else await postJSON('/local-llm/endpoints', { body })
      edit(null)
      await refresh()
      onChanged()
      setNotice('接続先を保存しました。')
    })

  const test = () =>
    run(async () => {
      const result = await postJSON<{
        ok: boolean
        models?: number
        detail?: string
      }>('/local-llm/endpoints/test', {
        body: {
          base_url: url.trim(),
          api_key: key,
          clear_api_key: clearKey,
          ...(editing ? { endpoint_id: editing.id } : {}),
        },
      })
      if (!result.ok) throw new Error(result.detail || '接続できませんでした。')
      setNotice(`接続できました（モデル ${result.models} 件）。`)
    })

  return (
    <fieldset
      disabled={disabled || pending}
      style={{ border: 0, padding: 0, marginBottom: 14 }}
    >
      <label style={{ display: 'block', fontWeight: 600 }}>
        翻訳接続先
        <select
          className="form-control"
          value={endpointId || ''}
          onChange={(event) => onSelect(event.target.value || null)}
        >
          <option value="">標準設定に従う</option>
          {endpointId &&
            !endpoints.some((endpoint) => endpoint.id === endpointId) && (
              <option value={endpointId}>削除済みの接続先</option>
            )}
          {endpoints.map((endpoint) => (
            <option key={endpoint.id} value={endpoint.id}>
              {endpoint.name}
              {endpoint.is_default ? '（標準）' : ''}
            </option>
          ))}
        </select>
      </label>
      {canManage && (
        <details style={{ marginTop: 8 }}>
          <summary>接続先を管理</summary>
          <p>接続先は研究室で共有します。API キーは保存後に表示されません。</p>
          {endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              style={{
                margin: '8px 0',
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <strong>
                {endpoint.name}
                {endpoint.is_default ? '（標準）' : ''}
              </strong>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => edit(endpoint)}
              >
                編集
              </button>
              {!endpoint.is_default && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    run(async () => {
                      await postJSON(
                        `/local-llm/endpoints/${endpoint.id}/default`
                      )
                      await refresh()
                      onChanged()
                      setNotice('標準接続先を変更しました。')
                    })
                  }
                >
                  標準に設定
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (window.confirm(`${endpoint.name} を削除しますか？`))
                    run(async () => {
                      await deleteJSON(`/local-llm/endpoints/${endpoint.id}`)
                      if (editing?.id === endpoint.id) edit(null)
                      await refresh()
                      onChanged()
                      setNotice('接続先を削除しました。')
                    })
                }}
              >
                削除
              </button>
            </div>
          ))}
          {endpoints.some((endpoint) => endpoint.is_default) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                run(async () => {
                  await postJSON('/local-llm/endpoints/default/clear')
                  await refresh()
                  onChanged()
                  setNotice('標準指定を解除しました。環境設定を使用します。')
                })
              }
            >
              標準指定を解除
            </button>
          )}
          <h3 style={{ fontSize: 16, marginTop: 12 }}>
            {editing ? '接続先を編集' : '接続先を追加'}
          </h3>
          <label style={{ display: 'block' }}>
            接続先の名前
            <input
              className="form-control"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label style={{ display: 'block' }}>
            API の URL
            <input
              className="form-control"
              value={url}
              maxLength={500}
              placeholder="http://host.docker.internal:8000/v1"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label style={{ display: 'block' }}>
            API キー
            <input
              type="password"
              autoComplete="new-password"
              className="form-control"
              value={key}
              maxLength={500}
              placeholder={
                editing?.has_api_key
                  ? '保存済み（空欄で維持）'
                  : '認証なしの場合は空欄'
              }
              disabled={clearKey}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          {editing?.has_api_key && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => setClearKey(event.target.checked)}
                />{' '}
                保存済み API キーを削除
              </label>
              <p>
                URL を変更する場合は、必要な API キーを入力し直してください。
              </p>
            </>
          )}
          <details style={{ margin: '8px 0' }}>
            <summary>詳細設定</summary>
            <label style={{ display: 'block' }}>
              追加パラメータ（JSON）
              <textarea
                className="form-control"
                rows={3}
                value={extra}
                maxLength={4000}
                onChange={(event) => setExtra(event.target.value)}
              />
            </label>
            <label style={{ display: 'block' }}>
              チャンクの目安文字数
              <input
                type="number"
                className="form-control"
                min={200}
                max={200000}
                placeholder="全体の既定値"
                value={chunkChars}
                onChange={(event) => setChunkChars(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={minimal}
                onChange={(event) => setMinimal(event.target.checked)}
              />{' '}
              翻訳特化モデル用の最小プロンプト
            </label>
            {minimal && (
              <p>
                最小プロンプトでは用語集・文体指示を送らず、直近の対訳を文脈として使います。
              </p>
            )}
          </details>
          <label style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(event) => setMakeDefault(event.target.checked)}
            />{' '}
            この接続先を標準にする
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!url.trim()}
              onClick={test}
            >
              接続テスト
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim() || !url.trim()}
              onClick={save}
            >
              {editing ? '接続先を更新' : '接続先を保存'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => edit(null)}
              >
                編集を取り消す
              </button>
            )}
          </div>
        </details>
      )}
      {error && (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="alert alert-info">
          {notice}
        </div>
      )}
    </fieldset>
  )
}
