import type { Folder } from '../../../../../types/folder'

export type TexDocOption = { id: string; name: string; path: string }

/** 公式の Folder.folders を辿る。root の空名と入れ子のフォルダーを正規化する。 */
export function collectTexDocs(folder: Folder | undefined): TexDocOption[] {
  const docs: TexDocOption[] = []
  const visit = (node: Folder, parent: string, isRoot = false) => {
    // rootFolder は内部名であり、利用者のファイルパスには含めない。
    const path = isRoot ? parent : [parent, node.name].filter(Boolean).join('/')
    for (const doc of node.docs || []) {
      if (doc.name.toLowerCase().endsWith('.tex')) {
        docs.push({
          id: doc._id,
          name: doc.name,
          path: [path, doc.name].filter(Boolean).join('/'),
        })
      }
    }
    for (const child of node.folders || []) visit(child, path)
  }
  if (folder) visit(folder, '', true)
  return docs
}
