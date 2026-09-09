/**
 * Manage Site → E-mail → "Send a test e-mail" (UI round 10, item 6).
 *
 * Sends ONE test message through the STORED E-mail section (same fields the
 * production EmailSender uses, loaded via SiteSettingsManager.getSection).
 * Site-admin only. Rate-limited per admin (5/min). Errors are sanitized —
 * SMTP credentials are never echoed back to the client.
 *
 * Follows the admin-tools error convention: HttpErrorHandler responses
 * (not thrown OErrors — the web error handler would swallow the message).
 */
import { getSection } from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import nodemailer from 'nodemailer'
import * as aws from '@aws-sdk/client-ses'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOCKET_TIMEOUT_MS = 20 * 1000
const RATE_LIMIT = { max: 5, windowMs: 60 * 1000 }

// Per-process token bucket (good enough for an admin console action).
const buckets = new Map()

export function tryConsumeLimit(userId) {
  const now = Date.now()
  let list = buckets.get(userId) || []
  list = list.filter(t => now - t < RATE_LIMIT.windowMs)
  if (list.length >= RATE_LIMIT.max) {
    buckets.set(userId, list)
    return false
  }
  list.push(now)
  buckets.set(userId, list)
  return true
}

/**
 * Map the stored E-mail section onto a nodemailer transport. Exported for
 * unit testing (pure + deterministic).
 */
export function buildTransport(email) {
  if (email.driver === 'ses') {
    if (!email.accessKeyId || !email.sesSecret) {
      return { error: 'SES credentials are not configured yet' }
    }
    // Same construction the production EmailSender uses (aws SES
    // transport with @aws-sdk/client-ses). Newer nodemailer builds
    // reject the legacy SES config, so catch that and surface a clean
    // configuration error in the admin console.
    try {
      const ses = new aws.SESClient({
        apiVersion: '2010-12-01',
        region: email.sesRegion || undefined,
        credentials: {
          accessKeyId: email.accessKeyId,
          secretAccessKey: email.sesSecret,
        },
      })
      return { client: nodemailer.createTransport({ SES: { ses, aws } }) }
    } catch {
      return {
        error:
          "This build's nodemailer does not support the legacy SES driver (use SMTP)",
      }
    }
  }

  if (email.driver !== 'smtp') {
    return { error: 'Unknown e-mail driver: ' + String(email.driver) }
  }
  if (!email.host) return { error: 'SMTP host is not configured yet' }

  const port = Number(email.port) || 465
  const smtp = {
    host: email.host,
    port,
    // 465 = implicit TLS (secure); 587 = STARTTLS unless the admin opted out.
    secure: email.secure === undefined ? port === 465 : email.secure === true,
    ignoreTLS: email.ignoreTLS === true,
    tls: { rejectUnauthorized: email.tlsRejectUnauth === true },
    logger: false,
  }
  if (email.name) smtp.name = email.name
  if (email.user && email.pass) {
    smtp.auth = { user: email.user, pass: email.pass }
  }
  return { client: nodemailer.createTransport(smtp) }
}

export default {
  sendTestEmail: expressify(async (req, res) => {
    const userId =
      req.session?.user?._id || req.session?.user?.id || 'unknown'
    const to = String(req.body?.to || '').trim().toLowerCase()

    if (!EMAIL_RE.test(to)) {
      return HttpErrorHandler.unprocessableEntity(
        req,
        res,
        'Enter a valid e-mail address'
      )
    }
    if (!tryConsumeLimit(userId)) {
      res.status(429).json({ message: 'Too many test e-mails — please wait a minute' })
      return
    }

    const email = await getSection('email')
    const { client, error } = buildTransport(email)
    if (error || !client) {
      logger.warn({ userId }, 'admin: test e-mail blocked: ' + error)
      res.status(500).json({ message: error || 'E-mail is not configured' })
      return
    }

    const now = new Date().toISOString()
    const via =
      'driver=' + (email.driver || 'smtp') +
      (email.driver === 'smtp'
        ? ' host=' + (email.host || '?') + ' port=' + (email.port || '?')
        : '')
    const mail = {
      to,
      from: email.fromAddress || undefined,
      replyTo: email.replyTo || undefined,
      subject: '[Overleaf] E-mail configuration test',
      text:
        'This is a test e-mail sent from the Overleaf admin console ' +
        '(Manage Site → E-mail).\n\nSent at: ' + now + '\nVia: ' + via + '.',
      html:
        '<p>This is a test e-mail sent from the Overleaf admin console ' +
        '(Manage Site → E-mail).</p>' +
        '<p>Sent at: ' + now + ' via <code>' + via + '</code></p>',
      socketTimeout: SOCKET_TIMEOUT_MS,
    }

    const t0 = Date.now()
    try {
      await client.sendMail(mail)
    } catch (err) {
      logger.error(
        { err, ms: Date.now() - t0, to },
        'admin: test e-mail FAILED (cause not returned to client)'
      )
      const detail = err?.responseText || err?.code || err?.message || 'unknown SMTP error'
      res.status(502).json({ message: 'Test e-mail failed to send: ' + String(detail).slice(0, 200) })
      return
    }
    logger.info({ ms: Date.now() - t0, to }, 'admin: test e-mail sent')
    res.json({ ok: true })
  }),
}
