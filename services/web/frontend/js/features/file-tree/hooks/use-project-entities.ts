import { useEffect, useState } from 'react'
import { getJSON } from '../../../infrastructure/fetch-json'
import { fileCollator } from '../util/file-collator'

export type Entity = {
  path: string
}

const alphabetical = (a: Entity, b: Entity) =>
  fileCollator.compare(a.path, b.path)

export function useProjectEntities(projectId?: string) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Entity[] | null>(null)
  const [error, setError] = useState<any>(false)

  useEffect(() => {
    // 選び直した時点で古い候補を消し、旧プロジェクトの応答を反映させない。
    setData(null)
    setError(false)
    setLoading(Boolean(projectId))
    if (projectId) {
      const controller = new AbortController()
      const { signal } = controller

      getJSON(`/project/${projectId}/entities`, { signal })
        .then(data => {
          if (!signal.aborted) setData(data.entities.sort(alphabetical))
        })
        .catch(error => {
          if (!signal.aborted) setError(error)
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false)
        })
      return () => controller.abort()
    }
  }, [projectId])

  return { loading, data, error }
}
