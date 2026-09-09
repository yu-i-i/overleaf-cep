/**
 * CE+ admin-UI vocabulary (2026-08-30) — shared building blocks for the
 * Manage Site tabs (SSO SAML/OIDC/LDAP and the six runtime sections).
 *
 * User-requested style: mirror the CE+ admin screens from
 * davrot/overleaf-cep@fe4ceb6 (modules/authentication/admin views
 * sso-admin.pug / email-admin.pug): classic bootstrap markup
 * (card / card-header with an enable switch, row + col-md-* field grids,
 * label.form-label with <strong> + text-danger asterisks,
 * input.form-control, form-check + form-check-input toggles,
 * form-text hints, h6.text-primary section headers).
 *
 * These primitives replace the OL* components + inline-style soup in the
 * tabs — one consistent look in light AND dark mode (no hardcoded colors
 * or font sizes).
 */
import React from 'react'

/** Password (and secret) inputs: wrap like CE+ does to stop DOM warnings
 *  and keep them grouped under the same label. */
export function NoAutofill ({ children }: { children: React.ReactNode }) {
  return (
    <form
      autoComplete="off"
      style={{ display: 'contents' }}
      onSubmit={e => e.preventDefault()}
    >
      {children}
    </form>
  )
}

export function Hint ({ children }: { children: React.ReactNode }) {
  return <div className="form-text">{children}</div>
}

export function SectionTitle ({ children, top }: {
  children: React.ReactNode
  top?: boolean
}) {
  return (
    <h6
      className={
        top
          ? 'text-primary border-bottom pb-2 mb-3 mt-4'
          : 'text-primary border-bottom pb-2 mb-3'
      }
    >
      {children}
    </h6>
  )
}

export function Req () {
  return <span className="text-danger">*</span>
}

export function Label ({ htmlFor, children, required }: {
  htmlFor?: string
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <label className="form-label" htmlFor={htmlFor}>
      <strong>{children}</strong>
      {required && <Req />}
    </label>
  )
}

export function Field ({ id, label, required, hint, type = 'text', value,
  onChange, placeholder, disabled }: {
  id: string
  label: React.ReactNode
  required?: boolean
  hint?: React.ReactNode
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const input = (
    <input
      id={id}
      className="form-control"
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={type === 'password' ? 'new-password' : undefined}
      onChange={e => onChange(e.currentTarget.value)}
    />
  )
  return (
    <>
      <Label htmlFor={id} required={required}>{label}</Label>
      {type === 'password' ? <NoAutofill>{input}</NoAutofill> : input}
      {hint && <Hint>{hint}</Hint>}
    </>
  )
}

export function Switch ({ id, checked, onChange, label, disabled }: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div className="form-check">
      <input
        className="form-check-input"
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.currentTarget.checked)}
      />
      <label className="form-check-label" htmlFor={id}>{label}</label>
    </div>
  )
}


/** Card shell: header with title + optional enable switch. */
// One or two columns inside a card (CE+ row/col-md-* vocabulary).
export function Row ({ cols, children }: {
  cols?: number
  children: React.ReactNode
}) {
  return (
    <div className="row mb-3">
      <div className={cols === 3 ? 'col-md-4' : 'col-md-6'}>{children}</div>
    </div>
  )
}

// Textarea field (blocked networks, notes, …) — BS 4 class vocabulary.
export function TextArea ({ id, label, required, hint, value, onChange, placeholder, rows = 5 }: {
  id: string
  label: React.ReactNode
  required?: boolean
  hint?: React.ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>
        <strong>{label}</strong>{required && <Req />}
      </label>
      <textarea
        id={id}
        className="form-control"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.currentTarget.value)}
      />
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}

export function Card ({ title, enabled, onEnabled, children, badge }: {
  title: React.ReactNode
  enabled?: boolean
  onEnabled?: (v: boolean) => void
  children: React.ReactNode
  badge?: React.ReactNode
}) {
  return (
    <div className="ce-admin-card card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center">
          {badge && (
            <span className="badge bg-info me-2">{badge}</span>
          )}
          <strong>{title}</strong>
        </div>
        {onEnabled && (
          <div className="form-check form-switch mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              checked={Boolean(enabled)}
              onChange={e => onEnabled(e.currentTarget.checked)}
            />
            <span className="form-check-label">Enabled</span>
          </div>
        )}
      </div>
      <div className="card-body">{children}</div>
    </div>
  )
}

/** Save footer in the CE+ page style: hint line + big save button. */
export function SaveFooter ({ flash, onSave, note, saveLabel }: {
  flash: { saving: boolean; saved: boolean; error: string | null }
  onSave: () => void
  note?: React.ReactNode
  saveLabel?: string
}) {
  return (
    <>
      <hr className="mt-4" />
      <div className="d-flex justify-content-between align-items-center">
        <div className="text-muted">
          {note || ' '}
          {flash.saved && !flash.error && (
            <span className="notification notification-type-success d-inline-block ms-2">
              Saved
            </span>
          )}
          {flash.error && (
            <span className="notification notification-type-error d-inline-block ms-2">
              {flash.error}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={flash.saving}
          onClick={onSave}
        >
          {flash.saving ? 'Saving…' : saveLabel || 'Save Configuration'}
        </button>
      </div>
    </>
  )
}

// Secret field — BS4 password input wrapped in the no-autofill form +
// "configured" placeholder; used by every section that stores secrets.
export function PasswordField ({ id, label, value, onChange, set, hint, required }: {
  id: string
  label: React.ReactNode
  value: string
  onChange: (v: string) => void
  set?: boolean
  hint?: React.ReactNode
  required?: boolean
}) {
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        <strong>{label}</strong>{required && <Req />}
      </label>
      <NoAutofill>
        <input
          id={id}
          className="form-control"
          type="password"
          autoComplete="new-password"
          value={value}
          placeholder={set ? '•••••• (configured — leave empty to keep)' : undefined}
          onChange={e => onChange(e.currentTarget.value)}
        />
      </NoAutofill>
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}
