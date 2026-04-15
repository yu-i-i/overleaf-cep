import Path from 'path'
import { fileURLToPath } from 'url'
import logger from '@overleaf/logger'
import { db } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { clearEmailConfigCache, applyEmailConfigToSettings } from '../../../emailConfigLoader.mjs'
import Settings from '@overleaf/settings'
import nodemailer from 'nodemailer'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const EMAIL_CONFIG_ID = 'email-settings'

function getDefaultConfig() {
  return {
    _id: EMAIL_CONFIG_ID,
    fromAddress: '',
    replyTo: '',
    driver: 'smtp',
    smtp: {
      host: '',
      port: 587,
      secure: false,
      ignoreTLS: false,
      name: '',
      logger: false,
      user: '',
      pass: '',
      tlsRejectUnauth: true,
    },
    ses: {
      accessKeyId: '',
      secretKey: '',
      region: 'us-east-1',
    },
    textEncoding: '',
    customFooter: '',
  }
}

const SENSITIVE_FIELDS = ['smtp.pass', 'ses.secretKey']
const MASK = '••••••••'

function _maskConfig(config) {
  const masked = JSON.parse(JSON.stringify(config))
  if (masked.smtp && masked.smtp.pass) masked.smtp.pass = MASK
  if (masked.ses && masked.ses.secretKey) masked.ses.secretKey = MASK
  return masked
}

function _sanitizeConfig(newConfig, existingConfig) {
  if (newConfig.smtp && newConfig.smtp.pass === MASK && existingConfig.smtp) {
    newConfig.smtp.pass = existingConfig.smtp.pass || ''
  }
  if (newConfig.ses && newConfig.ses.secretKey === MASK && existingConfig.ses) {
    newConfig.ses.secretKey = existingConfig.ses.secretKey || ''
  }
  return newConfig
}

async function _migrateFromEnv() {
  const email = Settings.email || {}
  const params = email.parameters || {}
  const config = getDefaultConfig()
  config.fromAddress = email.fromAddress || ''
  config.replyTo = email.replyTo || ''
  config.driver = params.AWSAccessKeyID ? 'ses' : 'smtp'
  if (params.host) config.smtp.host = params.host
  if (params.port) config.smtp.port = Number(params.port)
  if (params.secure) config.smtp.secure = true
  if (params.ignoreTLS) config.smtp.ignoreTLS = true
  if (params.name) config.smtp.name = params.name
  if (params.logger) config.smtp.logger = true
  if (params.auth) {
    config.smtp.user = params.auth.user || ''
    config.smtp.pass = params.auth.pass || ''
  }
  if (params.tls && params.tls.rejectUnauthorized !== undefined) {
    config.smtp.tlsRejectUnauth = !!params.tls.rejectUnauthorized
  }
  if (params.AWSAccessKeyID) config.ses.accessKeyId = params.AWSAccessKeyID
  if (params.AWSSecretKey) config.ses.secretKey = params.AWSSecretKey
  if (params.region) config.ses.region = params.region
  if (email.textEncoding) config.textEncoding = email.textEncoding
  if (Settings.customEmailFooter) config.customFooter = Settings.customEmailFooter
  return config
}

const EmailAdminController = {
  async adminPage(req, res) {
    try {
      let config = await db.emailConfigs.findOne({ _id: EMAIL_CONFIG_ID })
      if (!config) {
        config = await _migrateFromEnv()
      }
      const masked = _maskConfig(config)
      res.render(Path.resolve(__dirname, '../views/email-admin'), {
        emailConfig: JSON.stringify(masked),
      })
    } catch (e) {
      logger.error({ e }, 'Failed to load email admin page')
      res.status(500).send('Internal Server Error')
    }
  },

  async getConfig(req, res) {
    try {
      let config = await db.emailConfigs.findOne({ _id: EMAIL_CONFIG_ID })
      if (!config) {
        config = await _migrateFromEnv()
      }
      res.json(_maskConfig(config))
    } catch (e) {
      logger.error({ e }, 'Failed to get email config')
      res.status(500).json({ error: 'Failed to load config' })
    }
  },

  async saveConfig(req, res) {
    try {
      const newConfig = req.body
      delete newConfig._csrf

      const existingConfig =
        (await db.emailConfigs.findOne({ _id: EMAIL_CONFIG_ID })) ||
        getDefaultConfig()

      const sanitized = _sanitizeConfig(newConfig, existingConfig)
      sanitized._id = EMAIL_CONFIG_ID

      await db.emailConfigs.replaceOne(
        { _id: EMAIL_CONFIG_ID },
        sanitized,
        { upsert: true }
      )
      clearEmailConfigCache()
      await applyEmailConfigToSettings()

      logger.info({}, 'Email config saved')
      res.json({ success: true, message: 'Email configuration saved. A server restart is recommended for full effect.' })
    } catch (e) {
      logger.error({ e }, 'Failed to save email config')
      res.status(500).json({ error: 'Failed to save config' })
    }
  },

  async testEmail(req, res) {
    try {
      const config =
        (await db.emailConfigs.findOne({ _id: EMAIL_CONFIG_ID })) ||
        (await _migrateFromEnv())

      if (!config.fromAddress) {
        return res.json({ success: false, message: 'From address is not configured' })
      }

      const recipient = req.body.testRecipient
      if (!recipient) {
        return res.json({ success: false, message: 'Test recipient email is required' })
      }

      let transportOpts
      if (config.driver === 'ses') {
        const aws = await import('aws-sdk')
        const sesConfig = {
          accessKeyId: config.ses.accessKeyId,
          secretAccessKey: config.ses.secretKey,
          region: config.ses.region || 'us-east-1',
        }
        transportOpts = { SES: new aws.default.SES(sesConfig) }
      } else {
        transportOpts = {}
        if (config.smtp.host) transportOpts.host = config.smtp.host
        if (config.smtp.port) transportOpts.port = Number(config.smtp.port)
        if (config.smtp.secure) transportOpts.secure = true
        if (config.smtp.ignoreTLS) transportOpts.ignoreTLS = true
        if (config.smtp.name) transportOpts.name = config.smtp.name
        if (config.smtp.user) {
          transportOpts.auth = {
            user: config.smtp.user,
            pass: config.smtp.pass || '',
          }
        }
        transportOpts.tls = { rejectUnauthorized: config.smtp.tlsRejectUnauth !== false }
      }

      const transport = nodemailer.createTransport(transportOpts)

      await transport.verify()

      await transport.sendMail({
        from: config.fromAddress,
        to: recipient,
        subject: 'Overleaf Email Test',
        text: 'This is a test email from Overleaf. If you received this, your email configuration is working correctly.',
        html: '<p>This is a test email from Overleaf.</p><p>If you received this, your email configuration is working correctly.</p>',
      })

      transport.close()
      res.json({ success: true, message: `Test email sent to ${recipient}` })
    } catch (e) {
      logger.error({ e }, 'Email test failed')
      res.json({ success: false, message: `Test failed: ${e.message}` })
    }
  },
}

export default EmailAdminController
