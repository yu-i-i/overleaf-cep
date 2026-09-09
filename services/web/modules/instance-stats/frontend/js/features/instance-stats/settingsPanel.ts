import { getJSON, postJSON, putJSON } from '@/infrastructure/fetch-json'

export interface AlertConfig {
  alertEmails?: string[]
  alertEmail?: string
  diskWarningPercent: number
  ramWarningPercent: number
}

// 2026-09-01 (user feedback 3B): the alert email field is a multi-line
// textarea — one address per line (commas/semicolons also accepted).
function parseEmailText(text: string): string[] {
  const emails = text
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(s => s !== '')
  return [...new Set(emails)]
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Failed to save alert configuration.'
}

function buildPanel(root: HTMLElement, config: AlertConfig): void {
  const errorEl = document.createElement('p')
  errorEl.className = 'text-danger'
  errorEl.style.display = 'none'
  const setError = (message: string) => {
    errorEl.textContent = message
    errorEl.style.display = message ? '' : 'none'
  }

  const fieldLabel = (text: string): HTMLDivElement => {
    const div = document.createElement('div')
    const label = document.createElement('label')
    label.className = 'form-label'
    label.textContent = text
    div.append(label)
    return div
  }

  const emailTextarea = document.createElement('textarea')
  emailTextarea.className = 'form-control'
  emailTextarea.rows = 3
  emailTextarea.placeholder = 'one email address per line'
  const legacyEmails =
    config.alertEmails && config.alertEmails.length
      ? config.alertEmails
      : config.alertEmail
        ? [config.alertEmail]
        : []
  emailTextarea.value = legacyEmails.join('\n')

  const diskInput = document.createElement('input')
  diskInput.type = 'number'
  diskInput.min = '1'
  diskInput.max = '100'
  diskInput.className = 'form-control'
  diskInput.value = String(config.diskWarningPercent ?? 90)

  const ramInput = document.createElement('input')
  ramInput.type = 'number'
  ramInput.min = '1'
  ramInput.max = '100'
  ramInput.className = 'form-control'
  ramInput.value = String(config.ramWarningPercent ?? 90)

  const saveButton = document.createElement('button')
  saveButton.type = 'button'
  saveButton.className = 'btn btn-primary'
  saveButton.textContent = 'Save'

  const testButton = document.createElement('button')
  testButton.type = 'button'
  testButton.className = 'btn btn-secondary'
  testButton.textContent = 'Send test email'

  saveButton.addEventListener('click', async () => {
    const body = {
      alertEmails: parseEmailText(emailTextarea.value),
      diskWarningPercent: Number(diskInput.value),
      ramWarningPercent: Number(ramInput.value),
    }
    try {
      await putJSON('/admin/instance-stats/api/alert-config', { body })
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  })

  testButton.addEventListener('click', async () => {
    const emails = parseEmailText(emailTextarea.value)
    if (!emails.length) {
      setError('Enter at least one email address and save it before testing.')
      return
    }
    try {
      await postJSON('/admin/instance-stats/api/send-test-alert-email', {
        body: { emails },
      })
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  })

  root.append(
    fieldLabel('Alert email addresses — one per line (leave empty to disable alerts)'),
    emailTextarea,
    fieldLabel('Send a disk alert when usage exceeds (%)'),
    diskInput,
    fieldLabel('Send a RAM alert when usage exceeds (%)'),
    ramInput,
    saveButton,
    testButton,
    errorEl
  )
}

export async function initSettingsPanel(
  root: HTMLElement | null
): Promise<void> {
  if (!root) return
  try {
    const config = (await getJSON('/admin/instance-stats/api/alert-config')) as AlertConfig
    buildPanel(root, config)
  } catch (err) {
    const errorEl = document.createElement('p')
    errorEl.className = 'text-danger'
    errorEl.textContent = `Could not load alert settings: ${getErrorMessage(err)}`
    root.append(errorEl)
  }
}
