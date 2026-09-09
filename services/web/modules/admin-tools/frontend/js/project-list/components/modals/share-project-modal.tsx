import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { Project } from '../../../../../types/project/api'

// Core privilege enum (app/src/Features/Authorization/PrivilegeLevels.mjs):
// 'readOnly' | 'readAndWrite' | 'review' ('owner' is a member level, not an
// assignable option). N-F fix: the previous 'readonly'/'read-write' values
// were rejected by the core zod schema (400) and surfaced as the generic
// "Something went wrong" in this modal.
const PRIV_LABEL: Record<string, string> = {
  readOnly: 'viewer',
  readAndWrite: 'editor',
  review: 'reviewer',
  owner: 'owner',
}

type Member = {
  _id: string
  email: string
  privileges: string
}

type Invite = {
  _id: string
  email: string
  privileges: string
}

type SharingLink = {
  token: string
  privileges: string
} | null

const PRIVILEGE_OPTIONS = [
  { value: 'readOnly', key: 'viewer' },
  { value: 'readAndWrite', key: 'editor' },
  { value: 'review', key: 'reviewer' },
]

function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      'X-Csrf-Token': getMeta('ol-csrfToken'),
      ...(init && 'body' in init && init.body
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  })
}

type ShareProjectModalProps = {
  project: Project
  showModal: boolean
  handleCloseModal: () => void
}

function ShareProjectModal({
  project,
  showModal,
  handleCloseModal,
}: ShareProjectModalProps) {
  const { t } = useTranslation()
  const [members, setMembers] = useState<Array<Member>>([])
  const [invites, setInvites] = useState<Array<Invite>>([])
  const [sharingLink, setSharingLink] = useState<SharingLink>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPrivilege, setNewPrivilege] = useState('readOnly')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  // N-F (2026-09-01): the owner row uses `owner` / `setOwner` — this state
  // was missing, making both free identifiers. The ReferenceError
  // ("owner is not defined") crashed the modal render through the error
  // boundary every time it opened (minified 7709 chunk, user-reported).
  const [owner, setOwner] = useState<Member | null>(null)

  const projectId = project.id

  const reload = useCallback(async () => {
    setError('')
    try {
      const [membersRes, invitesRes] = await Promise.all([
        apiFetch(`/admin/project/${encodeURIComponent(projectId)}/members`),
        apiFetch(`/admin/project/${encodeURIComponent(projectId)}/invites`),
      ])
      if (!membersRes.ok || !invitesRes.ok) {
        throw new Error(String(membersRes.status))
      }
      const membersJson = (await membersRes.json()) as {
        owner?: Member | null
        members: Array<Member>
      }
      setOwner(membersJson.owner || null)
      const invitesJson = (await invitesRes.json()) as {
        invites: Array<Invite>
      }
      setMembers(membersJson.members || [])
      setInvites(invitesJson.invites || [])
      let link: SharingLink = null
      try {
        const linkRes = await apiFetch(
          `/admin/project/${encodeURIComponent(projectId)}/sharing-link`
        )
        if (linkRes.ok) {
          link = (await linkRes.json()) as SharingLink
        }
      } catch (linkErr) {
        link = null
      }
      setSharingLink(link)
    } catch (err) {
      setError(t('admin_share_error'))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    if (showModal) {
      setLoading(true)
      setNewEmail('')
      setNewPrivilege('readOnly')
      setCopied(false)
      void reload()
    }
  }, [showModal, reload])

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const email = newEmail.trim()
      if (!email) {
        setError(t('admin_share_invalid_email'))
        return
      }
      setSubmitting(true)
      setError('')
      try {
        const res = await apiFetch(
          `/admin/project/${encodeURIComponent(projectId)}/invite`,
          {
            method: 'POST',
            body: JSON.stringify({ email, privileges: newPrivilege }),
          }
        )
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        if (!res.ok) {
          if (json.error === 'cannot_invite_self') {
            setError(t('admin_share_cannot_invite_self'))
            setSubmitting(false)
            return
          }
          throw new Error(String(res.status))
        }
        setNewEmail('')
        void reload()
      } catch (err) {
        setError(t('admin_share_error'))
      } finally {
        setSubmitting(false)
      }
    },
    [newEmail, newPrivilege, projectId, reload, t]
  )

  const handlePrivilegeChange = useCallback(
    async (member: Member, privilege: string) => {
      setError('')
      setMembers(ms =>
        ms.map(m => (m._id === member._id ? { ...m, privileges: privilege } : m))
      )
      try {
        const res = await apiFetch(
          `/admin/project/${encodeURIComponent(projectId)}/users/${encodeURIComponent(
            member._id
          )}`,
          {
            method: 'PUT',
            body: JSON.stringify({ privilegeLevel: privilege }),
          }
        )
        if (!res.ok) throw new Error(String(res.status))
      } catch (err) {
        setError(t('admin_share_error'))
        void reload()
      }
    },
    [projectId, reload, t]
  )

  const handleRemove = useCallback(
    async (member: Member) => {
      if (!window.confirm(t('admin_share_remove_confirm'))) return
      setError('')
      try {
        const res = await apiFetch(
          `/admin/project/${encodeURIComponent(projectId)}/users/${encodeURIComponent(
            member._id
          )}`,
          { method: 'DELETE' }
        )
        if (!res.ok) throw new Error(String(res.status))
        void reload()
      } catch (err) {
        setError(t('admin_share_error'))
      }
    },
    [projectId, reload, t]
  )

  const handleCancelInvite = useCallback(
    async (invite: Invite) => {
      setError('')
      try {
        const res = await apiFetch(
          `/admin/project/${encodeURIComponent(projectId)}/invite/${encodeURIComponent(
            invite._id
          )}`,
          { method: 'DELETE' }
        )
        if (!res.ok) throw new Error(String(res.status))
        void reload()
      } catch (err) {
        setError(t('admin_share_error'))
      }
    },
    [projectId, reload, t]
  )

  const handleResendInvite = useCallback(
    async (invite: Invite) => {
      setError('')
      try {
        const res = await apiFetch(
          `/admin/project/${encodeURIComponent(projectId)}/invite/${encodeURIComponent(
            invite._id
          )}/resend`,
          { method: 'POST' }
        )
        if (!res.ok) throw new Error(String(res.status))
      } catch (err) {
        setError(t('admin_share_error'))
      }
    },
    [projectId, t]
  )

  const shareUrl = sharingLink
    ? `${window.location.origin}/project/${sharingLink.token}`
    : ''

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (copyErr) {
      // clipboard blocked — the URL is visible in the read-only input anyway
    }
  }, [shareUrl])

  return (
    <OLModal show={showModal} onHide={handleCloseModal}>
      <OLModalHeader>
        <OLModalTitle>{t('admin_share_title')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {error === '' && loading ? (
          <p className="text-muted">{t('admin_share_loading')}</p>
        ) : (
          <>
            {error !== '' && (
              <div className="alert alert-danger py-2" role="alert">
                {error}
              </div>
            )}
            <fieldset disabled={loading} className="w-100 border-0 p-0 my-0">
            <form onSubmit={handleAdd} className="mb-4">
              <OLFormLabel htmlFor="admin-share-email">
                {t('admin_share_add_email')}
              </OLFormLabel>
              <div className="d-flex gap-2">
                <OLFormControl
                  id="admin-share-email"
                  type="email"
              required
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="flex-grow-1"
                />
                <select
                  aria-label={t('admin_share_add_email')}
                  className="form-select"
                  value={newPrivilege}
                  onChange={e => setNewPrivilege(e.target.value)}
                >
                  {PRIVILEGE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {t(o.key)}
                    </option>
                  ))}
                </select>
                <OLButton
                  type="submit"
                  disabled={submitting || newEmail.trim() === ''}
                >
                  {t('admin_share_add')}
                </OLButton>
              </div>
            </form>

            <h6 className="mt-2">{t('admin_share_members')}</h6>
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">{t('admin_share_email')}</th>
                  <th scope="col">{t('admin_share_role')}</th>
                  <th scope="col" className="text-end">
                    {t('admin_share_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {owner && (
                  <tr>
                    <td>{owner.email}</td>
                    <td>
                      <span className="badge bg-secondary">
                        {t('owner')}
                      </span>
                    </td>
                    <td className="text-end" />
                  </tr>
                )}
                {members.map(m => {
                  const isOwner = m.privileges === 'owner'
                  return (
                    <tr key={m._id}>
                      <td>{m.email}</td>
                      <td>
                        {isOwner ? (
                          <span className="badge bg-secondary">
                            {t('owner')}
                          </span>
                        ) : (
                          <select
                            className="form-select form-select-sm"
                            value={m.privileges}
                            aria-label={`${m.email}`}
                            onChange={e =>
                              void handlePrivilegeChange(m, e.target.value)
                            }
                          >
                            {PRIVILEGE_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>
                                {t(o.key)}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="text-end">
                        {!isOwner && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => void handleRemove(m)}
                          >
                            {t('admin_share_remove')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {invites.length > 0 && (
              <>
                <h6 className="mt-3">{t('admin_share_invites')}</h6>
                <ul className="list-group">
                  {invites.map(inv => (
                    <li
                      key={inv._id}
                      className="list-group-item d-flex justify-content-between align-items-center"
                    >
                      <span>
                        {inv.email}{' '}
                        <span className="text-muted">
                          ({t(PRIV_LABEL[inv.privileges] || 'viewer')})
                        </span>
                      </span>
                      <span className="d-inline-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => void handleResendInvite(inv)}
                        >
                          {t('admin_share_resend')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => void handleCancelInvite(inv)}
                        >
                          {t('admin_share_cancel')}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h6 className="mt-3">{t('admin_share_link')}</h6>
            {sharingLink ? (
              <div className="d-flex gap-2">
                <OLFormLabel htmlFor="admin-share-url">
                  <span className="d-none">{t('admin_share_link')}</span>
                </OLFormLabel>
                <input
                  id="admin-share-url"
                  readOnly
                  value={shareUrl}
                  aria-label={t('admin_share_link')}
                  className="form-control form-control-sm flex-grow-1"
                  onFocus={e => e.target.select()}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => void handleCopyLink()}
                >
                  {copied ? t('copied') : t('admin_share_copy')}
                </button>
              </div>
            ) : (
              <p className="text-muted mb-0">{t('admin_share_no_link')}</p>
            )}
            </fieldset>
          </>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton onClick={handleCloseModal}>{t('OK')}</OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default ShareProjectModal
