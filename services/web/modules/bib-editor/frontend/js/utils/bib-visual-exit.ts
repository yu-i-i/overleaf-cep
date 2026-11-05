/** Only the attached, synchronized source document may accept an exit write. */
export function canCommitDepartingDocument(
  document: {
    joined: boolean
    cm6?: { view: unknown }
    getSnapshot(): string | undefined
  },
  view: { state: { doc: { toString(): string } } }
): boolean {
  return document.joined &&
    document.cm6?.view === view &&
    document.getSnapshot() === view.state.doc.toString()
}
