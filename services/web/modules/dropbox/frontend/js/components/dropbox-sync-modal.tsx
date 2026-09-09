import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

type DropboxUserStatus = {
  connected: boolean
  path?: string
}

// Optional status fields for projects
type ProjectDropboxStatus = DropboxUserStatus & {
  fullPath?: string
  projectPath?: string
  lastSyncAt?: string | null
  mergeStatus?: string
}

function formatDropboxPath(path: string) {
  if (!path || path === '/') return 'Apps/Overleaf Dev'
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function DropboxSyncModal({
  show,
  handleHide,
  projectId,
  initialProjectName,
}: {
  show: boolean
  handleHide: () => void
  projectId: string
  initialProjectName?: string
}) {
  const { t } = useTranslation()
  const [modalStatus, setModalStatus] =
    useState<'loading' | 'disconnected' | 'notLinkedProject' | 'connected'>('loading')
  const [status, setStatus] = useState<ProjectDropboxStatus>()
  const [projectName, setProjectName] = useState<string>()
  const [working, setWorking] = useState(false)

  // Initialize: fetch user connection and project state on first load
  useEffect(() => {
    if (!show) return

    // Set initial project name from parent component
    if (initialProjectName) {
      setProjectName(initialProjectName)
    }

    // First check if user has Dropbox account linked at /user/dropbox/status
    getJSON('/user/dropbox/status')
      .then((userData: DropboxUserStatus) => {
        setStatus(userData)
        if (!userData.connected) {
          setModalStatus('disconnected')
          return
        }
        // Then fetch project state and name from correct endpoint
        getJSON('/project/' + projectId + '/dropbox/state')
          .then((data: ProjectDropboxStatus) => {
            setStatus(data)

            if (!data.connected) {
              // Project is not linked to Dropbox - set status and use initial project name
              setModalStatus('notLinkedProject')
              return
            }

            // Project IS linked to Dropbox
            setProjectName(initialProjectName || `project_${projectId}`)
            setModalStatus('connected')
          })
          .catch((err: any) => {
            debugConsole.error(err?.message || err)
            setStatus({ connected: false } as ProjectDropboxStatus)
            setModalStatus('notLinkedProject')
            if (!initialProjectName) {
              setProjectName(`project_${projectId}`)
            }
          })
      })
      .catch((err: any) => {
        debugConsole.error(err?.message || err)
        setStatus({ connected: false } as DropboxUserStatus)
        setModalStatus('disconnected')
      })
  }, [show, initialProjectName, projectId])

  // Unlink project from Dropbox
  const handleUnlinkProject = async () => {
    setWorking(true)
    try {
      const res = await fetch(`/project/${projectId}/dropbox/state`, {
        method: 'DELETE',
        headers: {
          'X-Csrf-Token': getMeta('ol-csrfToken'),
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
      })

      let data: { message?: string; error?: string } = {}
      try { data = await res.json() } catch { /* non-JSON body */ }

      // D.5 / H7: only proceed to the "unlinked" UI when the server confirmed
      // (ok, or 404 = never linked). A failed unlink must NOT flip the UI.
      if (!res.ok && res.status !== 404) {
        debugConsole.error(`Dropbox unlink failed (${res.status})`, data)
        alert(t('failed_to_unlink_dropbox', { fallback: data.message || data.error || 'Unknown error' }))
        return
      }

      setStatus({ connected: false } as ProjectDropboxStatus)
      setModalStatus('notLinkedProject')
    } catch (err: any) {
      debugConsole.error(err?.message || err)
      alert(t('failed_to_unlink_dropbox', { fallback: err?.message || 'Unknown error' }))
    } finally {
      setWorking(false)
    }
  }

  // Link project to Dropbox
  const handleLinkProject = async () => {
    setWorking(true)
    try {
      // Get user's current Dropbox status (path)
      const userData: DropboxUserStatus | null = await getJSON('/user/dropbox/status')
      if (!userData?.connected) {
        throw new Error(t('dropbox_credentials_not_found'))
      }

      // Create project sync state with user's Dropbox configuration
      await postJSON(`/project/${projectId}/dropbox/link`, {
        body: {
          path: userData.path || '',
        },
      })

      // Refresh status after linking
      const updatedStatus = await getJSON('/project/' + projectId + '/dropbox/state')
      setStatus(updatedStatus)
      setModalStatus('connected')
    } catch (err: any) {
      debugConsole.error(err?.message || err)
      const errorMessage =
        err?.data?.error || err?.data?.message || err?.message || 'Unknown error'
      alert(
        t('failed_to_link_dropbox', {
          defaultValue: 'Failed to link project to Dropbox: {{error}}',
          error: errorMessage,
        })
      )
    } finally {
      setWorking(false)
    }
  }

  const handlePull = () => {
    setWorking(true)
    postJSON('/project/' + projectId + '/dropbox/pull')
      .then((pullResult) => {
        // RF.8: the server can answer 200 with `success: false` (e.g. the
        // remote folder no longer exists) — that is NOT a success. Surface
        // the server message, refresh state, and KEEP the linked UI state
        // (do not flip to "not linked").
        if (pullResult && (pullResult as { success?: boolean }).success === false) {
          const message = (pullResult as { message?: string }).message
          debugConsole.error('Dropbox pull reported not successful', pullResult)
          return getJSON('/project/' + projectId + '/dropbox/state')
            .then((stateData) => setStatus(stateData as ProjectDropboxStatus))
            .catch(() => { /* keep current state */ })
            .then(() => {
              alert(
                message || t('dropbox_pull_failed', { fallback: 'Failed to import from Dropbox' })
              )
            })
        }
        // Refresh status after pull
        return getJSON('/project/' + projectId + '/dropbox/state')
          .then((data) => {
            const next = data as ProjectDropboxStatus
            setStatus(next)
            alert(t('dropbox_pull_success', { fallback: 'Successfully imported from Dropbox' }))
          })
      })
      .catch((err: any) => {
        debugConsole.error(err?.message || err)
        alert(
          t('dropbox_pull_failed', {
            fallback: 'Failed to import from Dropbox: ',
          }) + (err?.data?.message || err?.message || t('generic_something_went_wrong'))
        )
      })
      .finally(() => setWorking(false))
  }

  const handlePush = () => {
    setWorking(true)
    postJSON('/project/' + projectId + '/dropbox/push')
      .then((pushResult) => {
        // RF.8: same as pull — a 200 with `success: false` is a failure
        // (e.g. remote not linked/missing), not a success.
        if (pushResult && (pushResult as { success?: boolean }).success === false) {
          const message = (pushResult as { message?: string }).message
          debugConsole.error('Dropbox push reported not successful', pushResult)
          return getJSON('/project/' + projectId + '/dropbox/state')
            .then((stateData) => setStatus(stateData as ProjectDropboxStatus))
            .catch(() => { /* keep current state */ })
            .then(() => {
              alert(
                message || t('dropbox_push_failed', { fallback: 'Failed to export to Dropbox' })
              )
            })
        }
        // Refresh status after push
        getJSON('/project/' + projectId + '/dropbox/state').then((data) => {
          setStatus(data as ProjectDropboxStatus)
          alert(t('dropbox_push_success', { fallback: 'Successfully exported to Dropbox' }))
        })
      })
      .catch((err: any) => {
        debugConsole.error(err?.message || err)
        alert(
          t('dropbox_push_failed', {
            fallback: 'Failed to export to Dropbox: ',
          }) + (err?.data?.message || err?.message || t('generic_something_went_wrong'))
        )
      })
      .finally(() => setWorking(false))
  }

  const handleClose = () => {
    handleHide()
    setModalStatus('loading')
    setStatus(undefined)
  }

  if (modalStatus === 'loading') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OLModalTitle>{t('dropbox')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <p>{t('loading')}...</p>
        </OLModalBody>
      </OLModal>
    )
  }

  // If user account not linked, show "link your account" message
  if (modalStatus === 'disconnected') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OLModalTitle>{t('dropbox')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <p className="small">
            {t('sync_with_dropbox_server')}{' '}
            <a href="/user/settings" target="_blank" rel="noreferrer">
              {t('link_your_account')}
            </a>
          </p>
        </OLModalBody>
      </OLModal>
    )
  }

  // Project not linked to Dropbox but user account is connected
  if (modalStatus === 'notLinkedProject') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OLModalTitle>{t('dropbox')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          {status?.path && (
            <p className="small">
              <strong>{t('connected_to')}:</strong> Dropbox
            </p>
          )}
          <p className="small mt-2 mb-3">{t('this_project_is_not_linked_to_dropbox')}</p>
          {projectName && (
            <div className="mb-3">
              <strong>{t('project_name_label')} </strong> {projectName}
            </div>
          )}
          <OLButton
            variant="secondary"
            onClick={() => handleLinkProject()}
            disabled={working}
          >
            {working ? t('loading') : t('dropbox_link_project_button')}
          </OLButton>
        </OLModalBody>
      </OLModal>
    )
  }

  // Connected state (both user and project linked) - show sync options
  const connectedStatus = status as ProjectDropboxStatus & {
    lastSyncAt?: string | null
  }

  if (modalStatus === 'connected') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OLModalTitle>{t('dropbox')}</OLModalTitle>
        </OLModalHeader>

        <OLModalBody>
          {status?.connected && (
            <>
              <p className="small">
                <strong>{t('connected_to')}:</strong> Dropbox
              </p>

              <p className="small">
                <strong>{t('dropbox_path_label')}:</strong>{' '}
                {/* BUG1: prefer the FULL Dropbox path (owner root + project
                    folder, e.g. "Apps/Overleaf Dev/A5 test"); legacy fields
                    remain as fallbacks. */}
                {formatDropboxPath(status.fullPath || status.projectPath || status.path || '/')}
              </p>

              {connectedStatus.lastSyncAt && (
                <p className="small">
                  <strong>{t('last_synced')}:</strong> {new Date(connectedStatus.lastSyncAt).toLocaleString()}
                </p>
              )}

              <div className="d-flex gap-2 mt-3 mb-3">
                <OLButton variant="secondary" onClick={handlePull} disabled={working}>
                  {working ? t('loading') : t('dropbox_import_from_dropbox')}
                </OLButton>
                <OLButton variant="primary" onClick={handlePush} disabled={working}>
                  {working ? t('loading') : t('dropbox_export_to_dropbox')}
                </OLButton>
              </div>

              <p className="small text-muted">{t('dropbox_import_note')}</p>
              <p className="small text-muted mb-2">{t('dropbox_export_note')}</p>

              {/* Unlink button */}
              <OLButton
                variant="danger-ghost"
                onClick={handleUnlinkProject}
                disabled={working}
              >
                {t('dropbox_unlink_button')}
              </OLButton>
              <p className="small text-muted">
                {t('dropbox_unlink_note')}
              </p>
            </>
          )}
        </OLModalBody>

        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleClose}>
            {t('close')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    )
  }

  // Fallback for any other state
  return null
}

export default DropboxSyncModal
