import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import {
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import getMeta from '@/utils/meta'
import LoadingSpinner from '@/shared/components/loading-spinner'

const DRAWIO_EMBED_URL = 'https://embed.diagrams.net/?embed=1&spin=1&proto=json&ui=kennedy'
const DRAWIO_ORIGIN = 'https://embed.diagrams.net'

const EMPTY_DIAGRAM =
  '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'

/**
 * Recursively find the parent folder ID for a given entity within the tree.
 */
function findParentFolderId(folder: any, entityId: string): string | null {
  if (folder.docs?.some((d: any) => d._id === entityId)) return folder._id
  if (folder.fileRefs?.some((f: any) => f._id === entityId)) return folder._id
  for (const sub of folder.folders || []) {
    if (sub._id === entityId) return folder._id
    const found = findParentFolderId(sub, entityId)
    if (found) return found
  }
  return null
}

/**
 * Draw.io editor component shown as a sourceEditorComponent.
 * When the open doc is a .drawio file, this overlays the CodeMirror editor
 * with an embedded Draw.io iframe. Changes are written back into the
 * CodeMirror document so they participate in Overleaf's real-time
 * collaboration and version history.
 *
 * On every explicit save, a PNG is also exported from the diagram and
 * uploaded as a companion file (e.g. diagram.drawio.png) so that it can be
 * included in LaTeX with:
 *
 *   \includegraphics{diagram.drawio.png}
 *
 * Protocol documentation: https://www.drawio.com/doc/faq/embed-mode
 */
export default function DrawioEditorWrapper() {
  const { openDocName } = useEditorOpenDocContext()
  const isDrawio = openDocName?.endsWith('.drawio')

  if (!isDrawio) return null
  return <DrawioEditor />
}

function DrawioEditor() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { getCurrentDocValue } = useEditorManagerContext()
  const { openDocId, openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const [loading, setLoading] = useState(true)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingExportFormatsRef = useRef<string[]>([])

  const getDocXml = useCallback(() => {
    const value = getCurrentDocValue()
    return value && value.trim().length > 0 ? value : EMPTY_DIAGRAM
  }, [getCurrentDocValue])

  // Replace the entire CM document content with the new XML
  const replaceDocContent = useCallback(
    (xml: string) => {
      if (!cmView) return
      cmView.dispatch({
        changes: {
          from: 0,
          to: cmView.state.doc.length,
          insert: xml,
        },
      })
    },
    [cmView]
  )

  // Upload exported image/svg to the same folder as the .drawio doc
  const uploadExport = useCallback(
    async (
      dataUrl: string,
      format: string,
      convertSvgToPdf: boolean = false
    ) => {
      try {
        const normalizedFormat = format.toLowerCase()
        const fileName = `${openDocName || 'diagram.drawio'}.${normalizedFormat}`
        setExportStatus(`Exporting ${normalizedFormat.toUpperCase()}…`)

        // Convert data URL to blob
        const dataRes = await fetch(dataUrl)
        const blob = await dataRes.blob()

        // Find parent folder of the .drawio doc
        const folderId =
          openDocId && fileTreeData
            ? findParentFolderId(fileTreeData, openDocId) || fileTreeData._id
            : fileTreeData?._id || ''

        const formData = new FormData()
        formData.append('qqfile', blob, fileName)
        formData.append('name', fileName)

        const querySuffix =
          normalizedFormat === 'svg' && convertSvgToPdf
            ? '&convert_svg_to_pdf=true'
            : ''

        const csrfToken = getMeta('ol-csrfToken') || ''

        const uploadRes = await fetch(
          `/project/${projectId}/upload?folder_id=${encodeURIComponent(folderId)}${querySuffix}`,
          {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': csrfToken },
            body: formData,
          }
        )

        if (!uploadRes.ok) {
          throw new Error(`Upload failed: ${uploadRes.status}`)
        }

        setExportStatus(`${normalizedFormat.toUpperCase()} exported ✓`)
        setTimeout(() => setExportStatus(null), 3000)
      } catch (err) {
        console.error(`Failed to upload ${format} export:`, err)
        setExportStatus(`${format.toUpperCase()} export failed`)
        setTimeout(() => setExportStatus(null), 5000)
      }
    },
    [openDocId, openDocName, fileTreeData, projectId]
  )

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== DRAWIO_ORIGIN) return

      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return

      switch (msg.event) {
        case 'init': {
          setLoading(false)
          const xml = getDocXml()
          iframe.contentWindow.postMessage(
            JSON.stringify({ action: 'load', xml, autosave: 1 }),
            DRAWIO_ORIGIN
          )
          break
        }

        case 'autosave': {
          // Debounce autosave – just update the CodeMirror doc
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = setTimeout(() => {
            replaceDocContent(msg.xml)
          }, 1000)
          break
        }

        case 'save': {
          // Explicit save: update CM doc immediately
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
          replaceDocContent(msg.xml)
          iframe.contentWindow.postMessage(
            JSON.stringify({ action: 'status', modified: false }),
            DRAWIO_ORIGIN
          )

          const exportFormats = ['png', 'svg']
          pendingExportFormatsRef.current.push(...exportFormats)

          for (const format of exportFormats) {
            iframe.contentWindow.postMessage(
              JSON.stringify({ action: 'export', format }),
              DRAWIO_ORIGIN
            )
          }

          break
        }

        case 'export': {
          // Receive exported image data and upload it
          if (msg.data) {
            const format =
              (msg.format && String(msg.format).toLowerCase()) ||
              pendingExportFormatsRef.current.shift() ||
              'png'
            const convertSvgToPdf = format === 'svg'
            uploadExport(msg.data, format, convertSvgToPdf)
          }
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [getDocXml, replaceDocContent, uploadExport])

  return (
    <div
      className="drawio-editor-container"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        background: 'var(--bg-light-primary, #fff)',
      }}
    >
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <LoadingSpinner />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={DRAWIO_EMBED_URL}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Draw.io Diagram Editor"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
      {exportStatus && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            padding: '6px 14px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            fontSize: 13,
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          {exportStatus}
        </div>
      )}
    </div>
  )
}
