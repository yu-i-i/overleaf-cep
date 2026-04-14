import logger from '@overleaf/logger'
import { db } from '../../app/src/infrastructure/mongodb.mjs'
import Settings from '@overleaf/settings'

const EMAIL_CONFIG_ID = 'email-settings'
let _cachedConfig = null

export function clearEmailConfigCache() {
  _cachedConfig = null
}

export async function loadEmailConfig() {
  if (_cachedConfig) return _cachedConfig

  try {
    const doc = await db.emailConfigs.findOne({ _id: EMAIL_CONFIG_ID })
    if (doc) {
      _cachedConfig = doc
      return doc
    }
  } catch (e) {
    logger.warn({ e }, 'Failed to load email config from DB, falling back to env vars')
  }

  // Fall back to env-based config (no migration on read)
  return _migrateFromEnv()
}

function _migrateFromEnv() {
  const email = Settings.email || {}
  const params = email.parameters || {}
  const config = {
    _id: EMAIL_CONFIG_ID,
    fromAddress: email.fromAddress || '',
    replyTo: email.replyTo || '',
    driver: params.AWSAccessKeyID ? 'ses' : 'smtp',
    smtp: {
      host: params.host || '',
      port: params.port ? Number(params.port) : 587,
      secure: !!params.secure,
      ignoreTLS: !!params.ignoreTLS,
      name: params.name || '',
      logger: !!params.logger,
      user: (params.auth && params.auth.user) || '',
      pass: (params.auth && params.auth.pass) || '',
      tlsRejectUnauth:
        params.tls && params.tls.rejectUnauthorized !== undefined
          ? !!params.tls.rejectUnauthorized
          : true,
    },
    ses: {
      accessKeyId: params.AWSAccessKeyID || '',
      secretKey: params.AWSSecretKey || '',
      region: params.region || 'us-east-1',
    },
    textEncoding: email.textEncoding || '',
    customFooter: Settings.customEmailFooter || '',
  }
  _cachedConfig = config
  return config
}

export async function applyEmailConfigToSettings() {
  try {
    const config = await loadEmailConfig()
    if (!config || !config.fromAddress) return

    const email = {
      fromAddress: config.fromAddress,
      replyTo: config.replyTo || undefined,
      textEncoding: config.textEncoding || undefined,
      parameters: {},
    }

    if (config.driver === 'ses') {
      email.driver = 'ses'
      email.parameters = {
        AWSAccessKeyID: config.ses.accessKeyId,
        AWSSecretKey: config.ses.secretKey,
        region: config.ses.region || 'us-east-1',
      }
    } else {
      const params = {}
      if (config.smtp.host) params.host = config.smtp.host
      if (config.smtp.port) params.port = Number(config.smtp.port)
      if (config.smtp.secure) params.secure = true
      if (config.smtp.ignoreTLS) params.ignoreTLS = true
      if (config.smtp.name) params.name = config.smtp.name
      if (config.smtp.logger) params.logger = true
      if (config.smtp.user) {
        params.auth = { user: config.smtp.user, pass: config.smtp.pass || '' }
      }
      params.tls = { rejectUnauthorized: config.smtp.tlsRejectUnauth !== false }
      email.parameters = params
    }

    Settings.email = email
    if (config.customFooter) {
      Settings.customEmailFooter = config.customFooter
    }
    logger.debug({}, 'Applied email config from DB to settings')
  } catch (e) {
    logger.warn({ e }, 'Failed to apply email config from DB')
  }
}
