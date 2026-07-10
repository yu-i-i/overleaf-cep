import Path from 'path'
import logger from '@overleaf/logger'
import registerNewUserAndSendActivationEmail from './UserRegistrationHandler.mjs'
import EmailHelper from '../../../../app/src/Features/Helpers/EmailHelper.mjs'
import Settings from '@overleaf/settings'

async function registrationPage(req, res, next) {
  // Check if the user is already logged in
  if (req.user != null) {
    return res.redirect(`/`)
  }

  const sharedProjectData = req.session.sharedProjectData || {}

  const newTemplateData = {}
  if (req.session.templateData != null) {
    newTemplateData.templateName = req.session.templateData.templateName
  }

  const allowedDomains = Settings.allowedRegistrationEmailDomains || []
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

  // If registration is restricted to a specific email domains,
  // check that the email domain is allowed
  const domain = parsedEmail.split('@').pop()
  const allowedDomains = Settings.allowedRegistrationEmailDomains

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
