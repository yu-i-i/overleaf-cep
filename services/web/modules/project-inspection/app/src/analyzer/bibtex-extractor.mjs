import { parser as BibTeXParser } from '../../../../../frontend/js/features/source-editor/lezer-bibtex/bibtex.mjs'
import { createLineIndex, createLocation } from './source-location.mjs'

export function extractBibtex(file) {
  if (file.content == null) {
    return {
      path: file.path,
      entityId: file.id,
      entries: [],
      parseErrorCount: 0,
      unavailable: true,
      skippedReason: file.skippedReason ?? 'content-unavailable',
    }
  }

  const lineStarts = createLineIndex(file.content)
  const tree = BibTeXParser.parse(file.content)
  const entries = []
  let parseErrorCount = 0

  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        parseErrorCount++
      } else if (node.type.name === 'CitationKey') {
        const key = file.content.slice(node.from, node.to).trim()
        if (key) {
          entries.push({
            key,
            location: createLocation(file.content, lineStarts, {
              entityId: file.id,
              path: file.path,
              from: node.from,
              to: node.to,
            }),
          })
        }
      }
    },
  })

  return {
    path: file.path,
    entityId: file.id,
    entries,
    parseErrorCount,
    unavailable: false,
  }
}
