import type { CompileResponseData } from '../../../../../types/compile'

export function compileResultKey(
  projectId: string,
  rootDocId: string | null | undefined,
  rootResourcePath?: string
) {
  // 文書 ID を優先し、名前変更でも同じ文書の結果を参照する。
  // プロジェクト ID も含め、別プロジェクトの結果と混同しない。
  if (rootDocId) return `${projectId}:doc:${rootDocId}`
  if (rootResourcePath) return `${projectId}:path:${rootResourcePath}`
  return null
}

/** セッション中の直近の成功結果だけを保持する。PDF 本体は既存の build URL を使う。 */
export class DocumentCompileCache {
  private results = new Map<
    string,
    { data: CompileResponseData; stale: boolean }
  >()

  peek(key: string | null) {
    return key ? this.results.get(key) : undefined
  }

  touch(key: string | null) {
    const result = this.peek(key)
    if (key && result) {
      this.results.delete(key)
      this.results.set(key, result)
    }
  }

  put(projectId: string, data: CompileResponseData, stale: boolean) {
    const key = compileResultKey(
      projectId,
      data.rootDocId,
      data.options?.rootResourcePath
    )
    // 失敗結果で直前の成功 PDF を置き換えない。
    if (
      !key ||
      data.status !== 'success' ||
      !data.outputFiles?.some((file) => file.path === 'output.pdf')
    ) {
      return
    }
    this.results.delete(key)
    this.results.set(key, { data, stale })
    if (this.results.size > 4) {
      this.results.delete(this.results.keys().next().value!)
    }
  }

  invalidate() {
    // include や共有スタイルへの編集もあり得るため、全メイン文書を古い扱いにする。
    for (const result of this.results.values()) result.stale = true
  }

  clear() {
    this.results.clear()
  }
}
