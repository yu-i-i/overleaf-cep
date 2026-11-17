import { useEffect, useState } from 'react'
import { postJSON } from '../../../infrastructure/fetch-json'
import { fileCollator } from '../util/file-collator'

export type OutputEntity = {
  path: string
  clsiServerId: string
  compileGroup: string
  build: string
}

const alphabetical = (a: OutputEntity, b: OutputEntity) =>
  fileCollator.compare(a.path, b.path)

export function useProjectOutputFiles(projectId?: string) {
  const [loading, setLoading] = useState<boolean>(false)
  const [data, setData] = useState<OutputEntity[] | null>(null)
  const [error, setError] = useState<any>(false)

  useEffect(() => {
    // プロジェクト変更時に旧コンパイル応答が届いても、別の候補として表示しない。
    setLoading(Boolean(projectId))
    setError(false)
    setData(null)
    if (projectId) {
      const controller = new AbortController()
      const { signal } = controller

      postJSON(`/project/${projectId}/compile`, {
        body: {
          check: 'silent',
          draft: false,
          incrementalCompilesEnabled: false,
        },
        signal,
      })
        .then(data => {
          if (signal.aborted) return
          if (data.status === 'success') {
            const filteredFiles = data.outputFiles.filter(
              (file: OutputEntity) => /\.(pdf|png|jpe?g|gif)$/i.test(file.path)
            )
            setData(
              filteredFiles
                .map((file: OutputEntity) => ({
                  ...file,
                  clsiServerId: data.clsiServerId,
                  compileGroup: data.compileGroup,
                }))
                .sort(alphabetical)
            )
          } else {
            setError('linked-project-compile-error')
          }
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
