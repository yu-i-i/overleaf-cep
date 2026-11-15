/** push が参照するダウンロード先と通知先を、当該プロジェクトのブリッジに限定する。 */
export function isValidSnapshot(body, projectId, bridgeBaseUrl) {
  if (
    !body ||
    !Number.isSafeInteger(body.latestVerId) ||
    body.latestVerId < 0 ||
    !Array.isArray(body.files)
  )
    return false

  try {
    const base = new URL(bridgeBaseUrl)
    if (!['http:', 'https:'].includes(base.protocol)) return false
    const prefix = `${base.pathname.replace(/\/$/, '')}/api/${projectId}/`
    const parseBridgeUrl = (value) => {
      if (typeof value !== 'string') throw new Error('missing URL')
      const url = new URL(value)
      if (
        url.origin !== base.origin ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new Error('invalid bridge URL')
      }
      if (!url.pathname.startsWith(prefix)) throw new Error('wrong project')
      return url
    }
    const postback = parseBridgeUrl(body.postbackUrl)
    const match = /^([\w-]+)\/postback$/.exec(
      postback.pathname.slice(prefix.length)
    )
    if (!match || postback.search) return false
    const key = match[1]
    const names = new Set()

    for (const file of body.files) {
      if (
        !file ||
        typeof file.name !== 'string' ||
        !file.name ||
        names.has(file.name)
      ) {
        return false
      }
      names.add(file.name)
      // 変更されていないファイルは URL を持たない（null も許容する）。
      if (file.url == null) continue
      const url = parseBridgeUrl(file.url)
      if (!/^[\w-]+$/.test(url.pathname.slice(prefix.length))) return false
      if ([...url.searchParams.keys()].join(',') !== 'key') return false
      if (url.searchParams.get('key') !== key) return false
    }
    return true
  } catch {
    return false
  }
}
