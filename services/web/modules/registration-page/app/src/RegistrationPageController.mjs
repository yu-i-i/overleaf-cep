import Path from 'node:path'
import { getSection } from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import registerNewUserAndSendActivationEmail from './UserRegistrationHandler.mjs'
import EmailHelper from '../../../../app/src/Features/Helpers/EmailHelper.mjs'
import Settings from '@overleaf/settings'

async function registrationPage(req, res, next) {
  // NOTE (user round 4, 2026-08-28): admins inspect /register while logged
  // in; the page is now viewable for logged-in sessions too (the POST
  // still refuses to create an account under an active session, below).

  const sharedProjectData = req.session.sharedProjectData || {}

  const newTemplateData = {}
  if (req.session.templateData != null) {
    newTemplateData.templateName = req.session.templateData.templateName
  }

  let allowedDomains = []
  try {
    allowedDomains = (await getSection('signup', Settings)).allowedEmailDomains || []
  } catch (err) {
    allowedDomains = Settings.allowedRegistrationEmailDomains || []
  }
  const displayDomains = new Map()

  for (const domain of allowedDomains) {
    const subdomainsOnly = domain.startsWith('*.')
    const base = subdomainsOnly ? domain.substring(2) : domain

    const existing = displayDomains.get(base)

    displayDomains.set(base, {
      domain: base,
      exact: existing?.exact || !subdomainsOnly,
      subdomains: existing?.subdomains || subdomainsOnly,
    })
  }

  const __dirname = Path.dirname(new URL(import.meta.url).pathname)
  res.render(Path.resolve(__dirname, '../views/register'), {
    title: 'register',
    sharedProjectData,
    newTemplateData,
    displayDomains: [...displayDomains.values()],
    csrfToken: req.csrfToken(),
  })
}

async function registerNewUser(req, res, next) {
  // A logged-in session must not be able to create a new account via the
  // registration form (it would take over the session): send the user back.
  if (req.user != null) {
    return res.redirect(`/`)
  }

  const { email, first_name, last_name } = req.body

  if (
    typeof first_name !== 'string' || first_name.length > 100 ||
    typeof last_name !== 'string' || last_name.length > 100
  ) {
    return res.status(400).json({ message: 'Too long name.' })
  }

  const parsedEmail = EmailHelper.parseEmail(email)
  if (!parsedEmail) {
    return res.status(400).json({ message: 'Invalid email address.' })
  }

  // If registration is restricted to specific email domains, check that
  // the email domain is allowed. 3e: the list comes from the admin-managed
  // SiteSettings signup section (stored value, env seed underneath).
  const domain = parsedEmail.split('@').pop()
  let allowedDomains
  try {
    const section = await getSection('signup', Settings)
    allowedDomains = section.allowedEmailDomains || []
  } catch (err) {
    allowedDomains = Settings.allowedRegistrationEmailDomains || []
  }

  if (
    allowedDomains &&
    !allowedDomains.some(pattern => {
      if (pattern.startsWith('*.')) {
        const base = pattern.slice(2)
        return domain.endsWith(`.${base}`)
      }
      return domain === pattern
    })
  ) {
    return res.status(403).json({
      message: 'Registration is not available for this email domain.',
    })
  }

  const t = req.i18n.translate
  try {
    const userDetails = { email, first_name, last_name }
    const success = await registerNewUserAndSendActivationEmail(userDetails)
    if (success) {
      return res.status(200).json({ message: t('register_success') })
    } else {
      return res.status(409).json({ message: { key: 'account_with_this_email_exists' } })
    }
  } catch (error) {
    if (error.message === 'error sending message') {
      return res.status(422).json({ message: t('failed_to_send_registration_email') })
    }
    return next(error)
  }
}

export default {
  registrationPage,
  registerNewUser
}
