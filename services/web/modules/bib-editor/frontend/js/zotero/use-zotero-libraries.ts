import { useEffect } from 'react'
import { type FetchError, getJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'

export type ZoteroGroup = { id: string; name: string }

export function useZoteroLibraries(active: boolean) {
  const { data, error, runAsync } = useAsync<{ groups: ZoteroGroup[] | null }, FetchError>()

  useEffect(() => {
    if (!active) return
    let controller: AbortController
    function refresh() {
      controller?.abort()
      controller = new AbortController()
      runAsync(getJSON<ZoteroGroup[] | null>('/user/zotero/groups', {
        signal: controller.signal, cache: 'no-store',
      }).then(groups => ({ groups })))
        .catch(() => {}) // The menu uses the response status below.
    }

    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      controller.abort()
      window.removeEventListener('focus', refresh)
    }
  }, [active, runAsync])

  const response = error?.response
  const available = response
    ? response.status !== 404 && !!response.headers.get('content-type')?.includes('application/json')
    : !!data && (data.groups === null || Array.isArray(data.groups))
  return { available, groups: available && !error ? data?.groups ?? null : null }
}
