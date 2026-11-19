/** 公式の拡張スロットから横並びパネルを開く。メイン文書・タブは切り替えない。 */
export default function BilingualEditorButton() {
  return (
    <button
      type="button"
      className="ol-cm-toolbar-button"
      style={{
        width: 'auto',
        minWidth: 'max-content',
        padding: '0 4px',
        whiteSpace: 'nowrap',
      }}
      aria-label="日英の横並び編集"
      title="日英の横並び編集"
      onClick={() =>
        window.dispatchEvent(new Event('overleaf:open-bilingual-editor'))
      }
    >
      横並び
    </button>
  )
}
