import { useCallback, useRef, useState, useEffect } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import LoadingSpinner from '@/shared/components/loading-spinner'
import getMeta from '@/utils/meta'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import './toast-image-editor.css'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg']

type ToastImageEditorProps = {
  file: {
    _id: string
    name: string
    hash: string
  }
}

/**
 * TUI Image Editor integration shown via the fileViewButtons module hook.
 * When the current file is an image, this renders an "Edit Image" button.
 * Clicking it opens a full-screen modal with the TUI editor.
 * On save the edited image is uploaded back to the project, replacing
 * the original file.
 */
export default function ToastImageFileViewButton({ file }: ToastImageEditorProps) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !IMAGE_EXTENSIONS.includes(ext)) return null

  return <EditImageButton file={file} />
}

function EditImageButton({
  file,
}: {
  file: ToastImageEditorProps['file']
}) {
  const [showEditor, setShowEditor] = useState(false)

  return (
    <>
      <div style={{ display: 'inline-block', marginLeft: '8px' }}>
        <OLButton
          variant="secondary"
          size="sm"
          onClick={() => setShowEditor(true)}
        >
          <MaterialIcon type="edit" className="align-middle" />{' '}
          <span>Edit Image</span>
        </OLButton>
      </div>
      {showEditor && (
        <ImageEditorModal file={file} onClose={() => setShowEditor(false)} />
      )}
    </>
  )
}

function ImageEditorModal({
  file,
  onClose,
}: {
  file: ToastImageEditorProps['file']
  onClose: () => void
}) {
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const imageUrl = `/project/${projectId}/blob/${file.hash}`

  // Find parent folder ID by traversing the file tree
  const findParentFolderId = useCallback(
    (folder: any, entityId: string): string | null => {
      if (folder.docs?.some((d: any) => d._id === entityId)) return folder._id
      if (folder.fileRefs?.some((f: any) => f._id === entityId)) return folder._id
      for (const sub of folder.folders || []) {
        if (sub._id === entityId) return folder._id
        const found = findParentFolderId(sub, entityId)
        if (found) return found
      }
      return null
    },
    []
  )

  useEffect(() => {
    let mounted = true
    let editorInstance: any = null
    let observer: MutationObserver | null = null

    const initEditor = async () => {
      try {
        // Dynamically import TUI Image Editor and its styles
        const [tuiModule] = await Promise.all([
          import('tui-image-editor'),
          import('tui-image-editor/dist/tui-image-editor.css'),
        ])
        const ImageEditor = tuiModule.default || tuiModule

        if (!mounted || !editorContainerRef.current) return

        editorInstance = new ImageEditor(editorContainerRef.current, {
          includeUI: {
            loadImage: {
              path: imageUrl,
              name: file.name,
            },
            theme: {
              'common.bi.image': '',
              'common.bisize.width': '0',
              'common.bisize.height': '0',
              'common.backgroundImage': 'none',
              'common.backgroundColor': '#1e1e1e',
              'header.backgroundImage': 'none',
              'header.backgroundColor': '#2d2d2d',
              'menu.normalIcon.color': '#ccc',
              'menu.activeIcon.color': '#fff',
              'menu.disabledIcon.color': '#555',
              'menu.hoverIcon.color': '#fff',
              'submenu.backgroundColor': '#2d2d2d',
              'submenu.partition.color': '#444',
              'submenu.normalIcon.color': '#ccc',
              'submenu.activeIcon.color': '#fff',
              'submenu.normalLabel.color': '#ccc',
              'submenu.activeLabel.color': '#fff',
              'checkbox.border': '1px solid #ccc',
              'range.pointer.color': '#fff',
              'range.bar.color': '#555',
              'range.subbar.color': '#fff',
              'range.disabledPointer.color': '#555',
              'range.disabledBar.color': '#333',
              'range.disabledSubbar.color': '#555',
              'range.value.color': '#fff',
              'range.value.fontWeight': 'lighter',
              'range.value.fontSize': '11px',
              'range.value.border': '1px solid #555',
              'range.value.backgroundColor': '#1e1e1e',
              'range.title.color': '#fff',
              'range.title.fontWeight': 'lighter',
              'colorpicker.button.border': '1px solid #555',
              'colorpicker.title.color': '#fff',
            },
            menu: [
              'crop',
              'flip',
              'rotate',
              'draw',
              'shape',
              'icon',
              'text',
              'mask',
              'filter',
            ],
            initMenu: 'filter',
            uiSize: {
              width: '100%',
              height: '100%',
            },
            menuBarPosition: 'left',
            loadButton: false,
            downloadButton: false,
          },
          cssMaxWidth: 1200,
          cssMaxHeight: 800,
          usageStatistics: false,
        })

        editorInstanceRef.current = editorInstance

        // Hide remaining built-in UI actions that may still appear.
        const hideLegacyButtons = () => {
          const container = editorContainerRef.current
          if (!container) return

          const selectors = [
            '[title="Load"]',
            '[title="Download"]',
            '.tui-image-editor-button-load',
            '.tui-image-editor-button-download',
            '[data-action="load"]',
            '[data-action="download"]',
          ]

          selectors
            .map(selector => container.querySelectorAll<HTMLElement>(selector))
            .forEach(nodeList => {
              nodeList.forEach(node => {
                node.style.display = 'none'
              })
            })

          container.querySelectorAll<HTMLElement>('button, a, div').forEach(node => {
            const text = (node.textContent || '').trim().toLowerCase()
            if (text === 'load' || text === 'download') {
              node.style.display = 'none'
            }
          })
        }

        hideLegacyButtons()

        observer = new MutationObserver(hideLegacyButtons)
        observer.observe(editorContainerRef.current, {
          childList: true,
          subtree: true,
        })

        setTimeout(hideLegacyButtons, 250)
        setTimeout(hideLegacyButtons, 1000)

        if (mounted) setLoading(false)
      } catch (err) {
        console.error('Failed to initialize image editor:', err)
        if (mounted) {
          setError('Failed to load the image editor. Please try again.')
          setLoading(false)
        }
      }
    }

    // Small delay to allow the modal to render
    const timer = setTimeout(initEditor, 100)

    return () => {
      mounted = false
      clearTimeout(timer)
      if (editorInstance?.destroy) {
        editorInstance.destroy()
      }
      if (observer) {
        observer.disconnect()
      }
    }
  }, [imageUrl, file.name])

  const handleSave = useCallback(async () => {
    const editor = editorInstanceRef.current
    if (!editor) return

    setSaving(true)
    setError(null)

    try {
      const dataUrl = editor.toDataURL()
      const response = await fetch(dataUrl)
      const blob = await response.blob()

      const formData = new FormData()
      formData.append('qqfile', blob, file.name)
      formData.append('name', file.name)

      const csrfToken = getMeta('ol-csrfToken') || ''
      const folderId = fileTreeData
        ? findParentFolderId(fileTreeData, file._id) || fileTreeData._id
        : ''

      const uploadRes = await fetch(
        `/project/${projectId}/upload?folder_id=${encodeURIComponent(folderId)}`,
        {
          method: 'POST',
          headers: {
            'X-CSRF-TOKEN': csrfToken,
          },
          body: formData,
        }
      )

      if (!uploadRes.ok) {
        throw new Error(`Upload failed: ${uploadRes.status}`)
      }

      onClose()
      // Trigger file view refresh
      window.dispatchEvent(new CustomEvent('file-view:file-opened'))
    } catch (err: any) {
      console.error('Failed to save image:', err)
      setError(err.message || 'Failed to save image')
    } finally {
      setSaving(false)
    }
  }, [file._id, file.name, fileTreeData, findParentFolderId, onClose, projectId])

  return (
    <OLModal size="lg" onHide={onClose} show className="toast-image-editor-modal">
      <OLModalHeader>
        <OLModalTitle>Edit Image: {file.name}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <div style={{ position: 'relative', height: '70vh' }}>
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <LoadingSpinner />
            </div>
          )}
          {error && (
            <div style={{ color: 'red', padding: '10px' }}>{error}</div>
          )}
          <div
            ref={editorContainerRef}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </OLButton>
        <OLButton
          variant="primary"
          onClick={handleSave}
          disabled={loading || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
