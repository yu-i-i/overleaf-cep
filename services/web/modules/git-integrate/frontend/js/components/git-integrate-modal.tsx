/**
 * git-integrate: Main modal component
 *
 * Multi-step wizard for connecting an Overleaf project to an external Git
 * repository, plus ongoing push controls and connection management.
 *
 * Inspired by TeXlyre's GitHubBackupModal.tsx
 * (texlyre/extras/backup/github/GitHubBackupModal.tsx, MIT Licence,
 *  Copyright (c) TeXlyre contributors).
 *
 * Key differences from TeXlyre:
 *  – All API calls go through Overleaf's own backend endpoints, not directly
 *    to the Git host.  The token is stored server-side and never held in
 *    browser state after the initial connection flow.
 *  – Uses Overleaf React component library (OLModal, OLButton, OLFormControl,
 *    OLFormSelect) for visual consistency.
 *  – React-i18next for translations.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON, getJSON, deleteJSON } from '@/infrastructure/fetch-json'
import {
    OLModal,
    OLModalBody,
    OLModalFooter,
    OLModalHeader,
    OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import Notification from '@/shared/components/notification'

// ── Supported providers ──────────────────────────────────────────────────────

const PROVIDERS = [
    {
        id: 'github',
        label: 'GitHub',
        docsUrl: 'https://docs.github.com/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token',
        baseUrlEditable: false,
        defaultBaseUrl: '',
        placeholder: 'ghp_...',
        permissionsHint: 'Classic token: repo scope (includes private repositories). Fine-grained token: Read access to metadata; Read and Write access to administration and code.',
    },
    {
        id: 'gitlab',
        label: 'GitLab',
        docsUrl: 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html',
        baseUrlEditable: true,
        defaultBaseUrl: 'https://gitlab.com/api/v4',
        placeholder: 'glpat-...',
        permissionsHint: 'Scopes: read_repository and write_repository. To also create new repositories, use the api scope instead.',
    },
    {
        id: 'gitea',
        label: 'Gitea',
        docsUrl: 'https://gitea.io',
        baseUrlEditable: true,
        defaultBaseUrl: 'https://gitea.com/api/v1',
        placeholder: 'your Gitea token',
        permissionsHint: 'Permission: repository → Read and Write. Also required: user → Read and Write (to list your repositories).',
    },
    {
        id: 'forgejo',
        label: 'Forgejo',
        docsUrl: 'https://codeberg.org',
        baseUrlEditable: true,
        defaultBaseUrl: 'https://codeberg.org/api/v1',
        placeholder: 'your Forgejo token',
        permissionsHint: 'Under “Repository and Organization Access” select your repositories, then set Permission: repository → Read and Write. Also required: under “User Access” set user → Read and Write (needed to list your repositories).',
    }
]

// ── Component ─────────────────────────────────────────────────────────────────

type Step = 'provider' | 'token' | 'repo' | 'branch' | 'connected'

interface Repo {
    id: string
    fullName: string
    name: string
    private: boolean
    defaultBranch: string
}

interface Branch {
    name: string
    protected: boolean
}

interface Connection {
    provider: string
    baseUrl: string | null
    repoId: string
    branch: string
    lastSyncSha: string | null
    updatedAt: string
}

interface GitIntegrateModalProps {
    show: boolean
    projectId: string
    handleHide: () => void
}

export default function GitIntegrateModal({
    show,
    projectId,
    handleHide,
}: GitIntegrateModalProps) {
    const { t } = useTranslation()

    // Wizard state
    const [step, setStep] = useState<Step>('provider')
    const [selectedProviderIdx, setSelectedProviderIdx] = useState(0)
    const [baseUrl, setBaseUrl] = useState('')
    const [token, setToken] = useState('')
    const [repos, setRepos] = useState<Repo[]>([])
    const [selectedRepo, setSelectedRepo] = useState('')
    const [branches, setBranches] = useState<Branch[]>([])
    const [selectedBranch, setSelectedBranch] = useState('main')

    // Connected state
    const [connection, setConnection] = useState<Connection | null>(null)
    const [commitMessage, setCommitMessage] = useState('')
    const [pushStatus, setPushStatus] = useState<'idle' | 'pushing' | 'success' | 'error'>('idle')
    const [pushError, setPushError] = useState<string | null>(null)
    const [conflictBranch, setConflictBranch] = useState<string | null>(null)
    const [pullStatus, setPullStatus] = useState<'idle' | 'pulling' | 'success' | 'error'>('idle')
    const [pullError, setPullError] = useState<string | null>(null)
    const [pullErrorPaths, setPullErrorPaths] = useState<string[] | null>(null)
    const [pullResult, setPullResult] = useState<{ textCount: number, binaryCount: number } | null>(null)

    // Shared loading / error
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Repo step
    const [repoSearch, setRepoSearch] = useState('')
    const [showCreateRepo, setShowCreateRepo] = useState(false)
    const [newRepoName, setNewRepoName] = useState('')
    const [newRepoPrivate, setNewRepoPrivate] = useState(true)
    const [creating, setCreating] = useState(false)

    const provider = PROVIDERS[selectedProviderIdx]

    // Repos filtered by the search term on the repo-selection step
    const filteredRepos = repoSearch.trim()
        ? repos.filter(r => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
        : repos

    // Initialise base URL when provider changes
    useEffect(() => {
        setBaseUrl(provider.defaultBaseUrl)
    }, [selectedProviderIdx])

    // Load existing connection when modal opens
    useEffect(() => {
        if (!show) return
        setError(null)
        setPushStatus('idle')
        setPushError(null)
        setConflictBranch(null)
        setPullStatus('idle')
        setPullError(null)
        setPullResult(null)
        getJSON(`/git-integrate/project/${projectId}`)
            .then((data: { connection: Connection | null }) => {
                if (data.connection) {
                    setConnection(data.connection)
                    setStep('connected')
                } else {
                    setConnection(null)
                    setStep('provider')
                    setToken('')
                    setRepos([])
                    setSelectedRepo('')
                    setBranches([])
                    setSelectedBranch('main')
                }
            })
            .catch(() => {
                setConnection(null)
                setStep('provider')
            })
    }, [show, projectId])

    // ── Step handlers ──────────────────────────────────────────────────────────

    const handleProviderNext = useCallback(() => {
        setError(null)
        setToken('')
        setRepos([])
        setSelectedRepo('')
        setBranches([])
        setSelectedBranch('main')
        setRepoSearch('')
        setShowCreateRepo(false)
        setStep('token')
    }, [])

    const handleTokenNext = useCallback(async () => {
        if (!token.trim()) {
            setError(t('git_integrate_token_required', 'Please enter a personal access token.'))
            return
        }
        setLoading(true)
        setError(null)
        try {
            const body: Record<string, string> = {
                provider: provider.id,
                token: token.trim(),
            }
            if (provider.baseUrlEditable && baseUrl.trim()) {
                body.baseUrl = baseUrl.trim()
            }
            const data: { repos: Repo[] } = await postJSON('/git-integrate/repos', { body })
            setRepos(data.repos)
            setSelectedRepo(data.repos[0]?.id ?? '')
            setSelectedBranch(data.repos[0]?.defaultBranch ?? 'main')
            setRepoSearch('')
            setShowCreateRepo(false)
            setStep('repo')
        } catch (err: any) {
            setError(err?.data?.error || t('git_integrate_token_error', 'Could not authenticate. Please check the token.'))
        } finally {
            setLoading(false)
        }
    }, [token, provider, baseUrl, t])

    const handleRepoNext = useCallback(async () => {
        if (!selectedRepo) return
        setLoading(true)
        setError(null)
        try {
            const body: Record<string, string> = {
                provider: provider.id,
                token: token.trim(),
                repoId: selectedRepo,
            }
            if (provider.baseUrlEditable && baseUrl.trim()) {
                body.baseUrl = baseUrl.trim()
            }
            const data: { branches: Branch[] } = await postJSON('/git-integrate/branches', { body })
            setBranches(data.branches)
            const defaultBranch =
                repos.find(r => r.id === selectedRepo)?.defaultBranch ?? 'main'
            setSelectedBranch(defaultBranch)
            setStep('branch')
        } catch (err: any) {
            setError(err?.data?.error || t('git_integrate_branches_error', 'Could not load branches.'))
        } finally {
            setLoading(false)
        }
    }, [selectedRepo, provider, token, baseUrl, repos, t])

    const handleConnect = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const body: Record<string, string> = {
                provider: provider.id,
                token: token.trim(),
                repoId: selectedRepo,
                branch: selectedBranch,
            }
            if (provider.baseUrlEditable && baseUrl.trim()) {
                body.baseUrl = baseUrl.trim()
            }
            await postJSON(`/git-integrate/project/${projectId}/connect`, { body })
            const data: { connection: Connection | null } = await getJSON(
                `/git-integrate/project/${projectId}`
            )
            setConnection(data.connection)
            setToken('') // clear token from memory
            setStep('connected')
        } catch (err: any) {
            setError(err?.data?.error || t('git_integrate_connect_error', 'Failed to connect.'))
        } finally {
            setLoading(false)
        }
    }, [provider, token, selectedRepo, selectedBranch, baseUrl, projectId, t])

    const handleDisconnect = useCallback(async () => {
        if (!window.confirm(t('git_integrate_disconnect_confirm', 'Disconnect this project from the Git repository?'))) return
        setLoading(true)
        setError(null)
        try {
            await deleteJSON(`/git-integrate/project/${projectId}`)
            setConnection(null)
            setStep('provider')
            setToken('')
        } catch (err: any) {
            setError(err?.data?.error || t('git_integrate_disconnect_error', 'Failed to disconnect.'))
        } finally {
            setLoading(false)
        }
    }, [projectId, t])

    const handlePush = useCallback(async () => {
        setPushStatus('pushing')
        setPushError(null)
        setConflictBranch(null)
        try {
            const data: { success: boolean, conflictBranch?: string } = await postJSON(
                `/git-integrate/project/${projectId}/push`,
                { body: { commitMessage: commitMessage.trim() || undefined } }
            )
            if (data.conflictBranch) {
                // Remote had diverged — OL content was pushed to a conflict branch.
                setConflictBranch(data.conflictBranch)
                setPushStatus('idle')
            } else {
                setPushStatus('success')
                // Refresh connection metadata (updatedAt)
                const meta: { connection: Connection | null } = await getJSON(
                    `/git-integrate/project/${projectId}`
                )
                setConnection(meta.connection)
            }
        } catch (err: any) {
            setPushError(err?.data?.error || t('git_integrate_push_error', 'Push failed.'))
            setPushStatus('error')
        }
    }, [projectId, commitMessage, t])

    const handlePull = useCallback(async () => {
        if (!conflictBranch && !window.confirm(t(
            'git_integrate_pull_confirm',
            'Sync from Git will merge remote changes into this project. Local changes that cannot be merged automatically will be pushed to a new branch for manual resolution. Continue?'
        ))) return
        setPullStatus('pulling')
        setPullError(null)
        setPullErrorPaths(null)
        setPullResult(null)
        try {
            const data: { success: boolean, textCount?: number, binaryCount?: number, conflictBranch?: string } = await postJSON(
                `/git-integrate/project/${projectId}/pull`, { body: {} }
            )
            if (data.conflictBranch) {
                // Automatic merge failed — Overleaf content pushed to a conflict branch.
                setConflictBranch(data.conflictBranch)
                setPullStatus('idle')
            } else {
                setPullStatus('success')
                setPullResult({ textCount: data.textCount ?? 0, binaryCount: data.binaryCount ?? 0 })
                // Clear any previous conflict state now that the user has synced.
                setConflictBranch(null)
                setPushStatus('idle')
            }
        } catch (err: any) {
            setPullError(err?.data?.error || t('git_integrate_pull_error', 'Pull failed.'))
            setPullErrorPaths(err?.data?.conflictedPaths || null)
            setPullStatus('error')
        }
    }, [projectId, conflictBranch, t])

    const handleChangeConnection = useCallback(() => {
        setStep('provider')
        setToken('')
        setRepos([])
        setSelectedRepo('')
        setBranches([])
        setSelectedBranch('main')
        setRepoSearch('')
        setShowCreateRepo(false)
        setError(null)
    }, [])

    const handleCreateRepo = useCallback(async () => {
        if (!newRepoName.trim()) return
        setCreating(true)
        setError(null)
        try {
            const body: Record<string, string | boolean> = {
                provider: provider.id,
                token: token.trim(),
                name: newRepoName.trim(),
                private: newRepoPrivate,
            }
            if (provider.baseUrlEditable && baseUrl.trim()) {
                body.baseUrl = baseUrl.trim()
            }
            const data: { repo: Repo } = await postJSON('/git-integrate/repos/create', { body })
            setRepos(prev => [data.repo, ...prev])
            setSelectedRepo(data.repo.id)
            setShowCreateRepo(false)
            setNewRepoName('')
        } catch (err: any) {
            setError(err?.data?.error || t('git_integrate_create_repo_error', 'Failed to create repository.'))
        } finally {
            setCreating(false)
        }
    }, [newRepoName, newRepoPrivate, provider, token, baseUrl, t])

    // ── Render ─────────────────────────────────────────────────────────────────

    const providerLabel = connection
        ? PROVIDERS.find(p => p.id === connection.provider)?.label ?? connection.provider
        : provider.label

    return (
        <OLModal
            show={show}
            onHide={handleHide}
            id="git-integrate-modal"
            backdrop="static"
            size="lg"
        >
            <OLModalHeader closeButton>
                <OLModalTitle>
                    {t('git_integrate_modal_title', 'Git Integration')}
                    {connection && (
                        <small className="text-muted ms-2" style={{ fontSize: '0.75em' }}>
                            {providerLabel} &mdash; {connection.repoId}
                        </small>
                    )}
                </OLModalTitle>
            </OLModalHeader>

            <OLModalBody>
                {error && (
                    <Notification type="error" content={error} className="mb-3" />
                )}

                {/* ── Step: provider selection ── */}
                {step === 'provider' && (
                    <div>
                        <OLFormGroup>
                            <OLFormLabel>{t('git_integrate_select_provider', 'Select Git hosting service')}</OLFormLabel>
                            <OLFormSelect
                                value={selectedProviderIdx}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                    setSelectedProviderIdx(Number(e.target.value))
                                }
                            >
                                {PROVIDERS.map((p, idx) => (
                                    <option key={p.id} value={idx}>
                                        {p.label}
                                    </option>
                                ))}
                            </OLFormSelect>
                        </OLFormGroup>
                        {provider.baseUrlEditable && (
                            <OLFormGroup>
                                <OLFormLabel>{t('git_integrate_base_url', 'API Base URL')}</OLFormLabel>
                                <OLFormControl
                                    type="text"
                                    value={baseUrl}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        setBaseUrl(e.target.value)
                                    }
                                    placeholder={provider.defaultBaseUrl}
                                />
                                <small className="form-text text-muted">
                                    {t('git_integrate_base_url_hint', 'Change only for self-hosted instances.')}
                                </small>
                            </OLFormGroup>
                        )}
                    </div>
                )}

                {/* ── Step: token entry ── */}
                {step === 'token' && (
                    <div>
                        <p>
                            {t('git_integrate_token_intro_pre', 'Enter a personal access token for')}{' '}
                            <strong>{provider.label}</strong>{' '}
                            {t('git_integrate_token_intro_post', 'with repository read/write access.')}{' '}
                            <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer">
                                {t('git_integrate_token_docs_link', 'How to create a token')}
                            </a>
                        </p>
                        <div className="alert alert-info py-2 mb-3" style={{ fontSize: '0.875em' }}>
                            <strong>{t('git_integrate_required_permissions', 'Required permissions:')}</strong>{' '}
                            {provider.permissionsHint}
                        </div>
                        <OLFormGroup>
                            <OLFormLabel>{t('git_integrate_token_label', 'Personal Access Token')}</OLFormLabel>
                            <OLFormControl
                                type="password"
                                value={token}
                                autoComplete="off"
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setToken(e.target.value)
                                }
                                placeholder={provider.placeholder}
                                onKeyDown={(e: React.KeyboardEvent) => {
                                    if (e.key === 'Enter') handleTokenNext()
                                }}
                            />
                        </OLFormGroup>
                    </div>
                )}

                {/* ── Step: repo selection ── */}
                {step === 'repo' && (
                    <div>
                        <OLFormGroup>
                            <OLFormLabel>{t('git_integrate_repo_filter', 'Filter repositories')}</OLFormLabel>
                            <OLFormControl
                                type="text"
                                value={repoSearch}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setRepoSearch(e.target.value)
                                }
                                placeholder={t('git_integrate_repo_filter_placeholder', 'Type to filter…')}
                            />
                            <small className="form-text text-muted">
                                {repos.length}{' '}{t('git_integrate_repos_loaded', 'repositories loaded')}
                                {repoSearch.trim() ? ` — ${filteredRepos.length} ${t('git_integrate_repos_matching', 'matching')}` : ''}
                            </small>
                        </OLFormGroup>
                        <OLFormGroup>
                            <OLFormLabel>{t('git_integrate_repo_label', 'Select repository')}</OLFormLabel>
                            <OLFormSelect
                                value={selectedRepo}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                    setSelectedRepo(e.target.value)
                                }
                            >
                                {filteredRepos.length > 0
                                    ? filteredRepos.map(r => (
                                        <option key={r.id} value={r.id}>
                                            {r.fullName}{r.private ? ' 🔒' : ''}
                                        </option>
                                    ))
                                    : <option disabled value="">{t('git_integrate_no_repos_match', 'No repositories match')}</option>
                                }
                            </OLFormSelect>
                        </OLFormGroup>
                        {!showCreateRepo && (
                            <button
                                type="button"
                                className="btn btn-link p-0 mt-1"
                                onClick={() => { setShowCreateRepo(true); setNewRepoName(''); setNewRepoPrivate(true) }}
                            >
                                {t('git_integrate_create_repo_link', '+ Create new repository')}
                            </button>
                        )}
                        {showCreateRepo && (
                            <div className="border rounded p-3 mt-2">
                                <h6 className="mb-3">{t('git_integrate_new_repo_title', 'Create new repository')}</h6>
                                <OLFormGroup>
                                    <OLFormLabel>{t('git_integrate_new_repo_name', 'Repository name')}</OLFormLabel>
                                    <OLFormControl
                                        type="text"
                                        value={newRepoName}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                            setNewRepoName(e.target.value)
                                        }
                                        placeholder="my-overleaf-project"
                                        onKeyDown={(e: React.KeyboardEvent) => {
                                            if (e.key === 'Enter' && newRepoName.trim()) handleCreateRepo()
                                        }}
                                    />
                                </OLFormGroup>
                                <div className="form-check mb-3">
                                    <input
                                        id="git-integrate-new-repo-private"
                                        className="form-check-input"
                                        type="checkbox"
                                        checked={newRepoPrivate}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                            setNewRepoPrivate(e.target.checked)
                                        }
                                    />
                                    <label className="form-check-label" htmlFor="git-integrate-new-repo-private">
                                        {t('git_integrate_new_repo_private', 'Private repository')}
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-primary btn-sm me-2"
                                    onClick={handleCreateRepo}
                                    disabled={creating || !newRepoName.trim()}
                                >
                                    {creating ? t('git_integrate_creating', 'Creating…') : t('git_integrate_create', 'Create')}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setShowCreateRepo(false)}
                                >
                                    {t('cancel', 'Cancel')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Step: branch selection ── */}
                {step === 'branch' && (
                    <OLFormGroup>
                        <OLFormLabel>{t('git_integrate_branch_label', 'Select branch')}</OLFormLabel>
                        {branches.length === 0 ? (
                            <>
                                <OLFormControl
                                    type="text"
                                    value={selectedBranch}
                                    readOnly
                                />
                                <div className="small text-muted mt-1">
                                    {t(
                                        'git_integrate_empty_repo_hint',
                                        'This repository is empty. Overleaf will initialise it by pushing to this branch.'
                                    )}
                                </div>
                            </>
                        ) : (
                            <OLFormSelect
                                value={selectedBranch}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                    setSelectedBranch(e.target.value)
                                }
                            >
                                {branches.map(b => (
                                    <option key={b.name} value={b.name}>
                                        {b.name}{b.protected ? ' 🔒' : ''}
                                    </option>
                                ))}
                            </OLFormSelect>
                        )}
                    </OLFormGroup>
                )}

                {/* ── Connected view ── */}
                {step === 'connected' && connection && (
                    <div>
                        <table className="table table-borderless table-sm mb-3">
                            <tbody>
                                <tr>
                                    <th scope="row">{t('git_integrate_info_provider', 'Provider')}</th>
                                    <td>{providerLabel}</td>
                                </tr>
                                <tr>
                                    <th scope="row">{t('git_integrate_info_repo', 'Repository')}</th>
                                    <td><code>{connection.repoId}</code></td>
                                </tr>
                                <tr>
                                    <th scope="row">{t('git_integrate_info_branch', 'Branch')}</th>
                                    <td><code>{connection.branch}</code></td>
                                </tr>
                                {connection.updatedAt && (
                                    <tr>
                                        <th scope="row">{t('git_integrate_info_last_pushed', 'Last connected')}</th>
                                        <td>{new Date(connection.updatedAt).toLocaleString()}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        <OLFormGroup>
                            <OLFormLabel>{t('git_integrate_commit_message_label', 'Commit message (optional)')}</OLFormLabel>
                            <OLFormControl
                                type="text"
                                value={commitMessage}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setCommitMessage(e.target.value)
                                }
                                placeholder={t('git_integrate_commit_message_placeholder', 'Overleaf export: {date}')}
                            />
                        </OLFormGroup>

                        {pushStatus === 'success' && (
                            <Notification
                                type="success"
                                content={t('git_integrate_push_success', 'Project exported to Git successfully.')}
                                className="mb-2"
                            />
                        )}
                        {pushStatus === 'error' && pushError && (
                            <Notification type="error" content={pushError} className="mb-2" />
                        )}
                        {conflictBranch && (
                            <Notification
                                type="warning"
                                className="mb-2"
                                content={
                                    <>
                                        <strong>{t('git_integrate_conflict_title', 'Merge conflict detected.')}</strong>
                                        {' '}
                                        {t(
                                            'git_integrate_conflict_body',
                                            'Changes were made both in Overleaf and in the Git repository that cannot be merged automatically. Your Overleaf content has been pushed to a new branch'
                                        )}
                                        {' '}<code>{conflictBranch}</code>.
                                        {' '}
                                        {t(
                                            'git_integrate_conflict_instructions',
                                            'Merge this branch into your default branch using a pull request or your local Git client, then click "Sync from Git" below.'
                                        )}
                                    </>
                                }
                            />
                        )}
                        {pullStatus === 'success' && pullResult && (
                            <Notification
                                type="success"
                                content={t(
                                    'git_integrate_pull_success',
                                    `Pull complete: ${pullResult.textCount} text file(s) and ${pullResult.binaryCount} binary file(s) updated.`
                                )}
                                className="mb-2"
                            />
                        )}
                        {pullStatus === 'error' && pullError && (
                            <Notification
                                type="error"
                                className="mb-2"
                                content={
                                    <>
                                        <p>{pullError}</p>
                                        {pullErrorPaths && pullErrorPaths.length > 0 && (
                                            <ul className="git-integrate-conflict-paths">
                                                {pullErrorPaths.map(path => (
                                                    <li key={path}>{path}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </>
                                }
                            />
                        )}
                    </div>
                )}
            </OLModalBody>

            <OLModalFooter>
                {/* Back controls */}
                {(step === 'token' || step === 'repo' || step === 'branch') && (
                    <OLButton
                        variant="secondary"
                        onClick={() => {
                            setError(null)
                            if (step === 'token') setStep('provider')
                            else if (step === 'repo') setStep('token')
                            else setStep('repo')
                        }}
                    >
                        {t('back', 'Back')}
                    </OLButton>
                )}

                {/* Connected: change connection */}
                {step === 'connected' && (
                    <OLButton
                        variant="secondary"
                        onClick={handleChangeConnection}
                        disabled={loading || pushStatus === 'pushing'}
                    >
                        {t('git_integrate_change_connection', 'Change connection')}
                    </OLButton>
                )}

                {/* Connected: disconnect */}
                {step === 'connected' && (
                    <OLButton
                        variant="danger"
                        onClick={handleDisconnect}
                        disabled={loading || pushStatus === 'pushing'}
                    >
                        {t('git_integrate_disconnect', 'Disconnect')}
                    </OLButton>
                )}

                {/* Cancel / Close */}
                <OLButton variant="secondary" onClick={handleHide}>
                    {t('close', 'Close')}
                </OLButton>

                {/* Forward / action button */}
                {step === 'provider' && (
                    <OLButton variant="primary" onClick={handleProviderNext}>
                        {t('next', 'Next')}
                    </OLButton>
                )}
                {step === 'token' && (
                    <OLButton
                        variant="primary"
                        onClick={handleTokenNext}
                        disabled={loading || !token.trim()}
                    >
                        {loading
                            ? t('connecting', 'Connecting…')
                            : t('next', 'Next')}
                    </OLButton>
                )}
                {step === 'repo' && (
                    <OLButton
                        variant="primary"
                        onClick={handleRepoNext}
                        disabled={loading || !selectedRepo}
                    >
                        {loading ? t('loading', 'Loading…') : t('next', 'Next')}
                    </OLButton>
                )}
                {step === 'branch' && (
                    <OLButton
                        variant="primary"
                        onClick={handleConnect}
                        disabled={loading || !selectedBranch}
                    >
                        {loading
                            ? t('connecting', 'Connecting…')
                            : t('git_integrate_confirm_connect', 'Connect')}
                    </OLButton>
                )}
                {step === 'connected' && (
                    <OLButton
                        variant={conflictBranch ? 'primary' : 'secondary'}
                        onClick={handlePull}
                        disabled={pullStatus === 'pulling' || pushStatus === 'pushing'}
                    >
                        {pullStatus === 'pulling'
                            ? t('git_integrate_pulling', 'Pulling…')
                            : conflictBranch
                                ? t('git_integrate_pull_after_conflict', 'Sync from Git (I merged)')
                                : t('git_integrate_pull', 'Pull from Git')}
                    </OLButton>
                )}
                {step === 'connected' && (
                    <OLButton
                        variant={conflictBranch ? 'secondary' : 'primary'}
                        onClick={handlePush}
                        disabled={pushStatus === 'pushing' || pullStatus === 'pulling'}
                    >
                        {pushStatus === 'pushing'
                            ? t('git_integrate_pushing', 'Pushing…')
                            : t('git_integrate_push', 'Push to Git')}
                    </OLButton>
                )}
            </OLModalFooter>
        </OLModal>
    )
}
