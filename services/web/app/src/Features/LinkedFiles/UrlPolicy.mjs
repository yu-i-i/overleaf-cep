import dns from 'node:dns/promises'
import net from 'node:net'
import logger from '@overleaf/logger'
import { OError } from '../Errors/Errors.js'
import LinkedFilesErrors from './LinkedFilesErrors.mjs'

/**
 * 3d (2026-08-28): SSRF guard for external-URL linked files.
 *
 * The admin-managed `externalUrl` site settings (Manage Extensions →
 * External URLs; env seeds underneath) define:
 *  - `allowedResourcesRegex` (optional allowlist — the full URL must
 *    match; empty = no allowlist)
 *  - `blockedNetworks` (CIDR list; resolved IPs must not fall inside)
 *
 * The check runs BEFORE the fetch and AGAIN on every redirect hop
 * (a 302 to an internal host must not bypass the guard).
 *
 * Pure helpers (ipInCidr, matchesResourceRegex) are unit-tested.
 */

/** Convert an IPv4/IPv6 address to a BigInt (big endian). */
function ipToBigInt(ip) {
  if (net.isIPv4(ip)) {
    let n = 0n
    for (const part of ip.split('.')) {
      n = (n << 8n) | BigInt(part >>> 0 & 0xff)
    }
    return n
  }
  // IPv6: expand '::' manually
  const halves = ip.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = Math.max(0, 8 - left.length - right.length)
  const groups = [...left]
  for (let i = 0; i < missing; i += 1) groups.push('0')
  for (const g of right) groups.push(g)
  let n = 0n
  for (const g of groups.slice(0, 8)) {
    n = (n << 16n) | BigInt(parseInt(g, 16) || 0)
  }
  return n
}

/** Is `ip` inside `cidr` (e.g. 10.0.0.0/8, fc00::/7, ::1/128)? */
function ipInCidr(ip, cidr) {
  if (typeof cidr !== 'string') return false
  const i = cidr.lastIndexOf('/')
  if (i < 0) return ip === cidr.trim()
  const network = cidr.slice(0, i).trim()
  const bits = Number.parseInt(cidr.slice(i + 1), 10)
  if (Number.isNaN(bits)) return false
  try {
    const ipN = ipToBigInt(ip)
    const netN = ipToBigInt(network)
    const totalBits = net.isIPv4(ip) ? 32 : 128
    const totalBitsNet = net.isIPv4(network) ? 32 : 128
    if (totalBits !== totalBitsNet) return false
    if (bits > totalBits) return false
    if (bits === 0) return true
    const mask = (1n << BigInt(totalBits - bits)) - 1n
    return (ipN & ~mask) === (netN & ~mask)
  } catch (e) {
    return false
  }
}

/** Does the full URL satisfy the admin allowlist regex? */
function matchesResourceRegex(url, regex) {
  if (!regex) return true
  let re
  try {
    re = new RegExp(regex)
  } catch (err) {
    // A broken admin regex must not silently allow everything.
    throw new OError(
      'The site external-URL allowlist regex is misconfigured',
      { status: 400 }
    ).withCause(err)
  }
  return re.test(url)
}

/** Resolve a hostname to all its IPs (IP literals resolve to themselves). */
async function resolveIps(host) {
  if (net.isIP(host)) return [host]
  const results = await dns.lookup(host, { all: true, verbatim: true })
  return results.map(r => r.address)
}

/**
 * Assert the URL is allowed by the site's externalUrl policy.
 * Throws a 400 OError with an admin-visible message when blocked.
 */
async function assertUrlAllowed(url, section) {
  const cfg = section || {}
  // Allowlist filter: when set, the FULL url must match (admin UI copy:
  // "only URLs matching this regular expression may be added").
  if (!matchesResourceRegex(url, cfg.allowedResourcesRegex)) {
    throw new LinkedFilesErrors.UrlPolicyDeniedError(
      'This URL is not allowed by the site policy (allowed resources regex)',
      { status: 403, url }
    )
  }

  const blocked = Array.isArray(cfg.blockedNetworks) ? cfg.blockedNetworks : []
  if (!blocked.length) return

  let host
  try {
    host = new URL(url).hostname
  } catch (err) {
    throw new OError(`invalid url: ${url}`, { status: 400 }).withCause(err)
  }

  let ips
  try {
    ips = await resolveIps(host)
  } catch (err) {
    // DNS failure is not a policy decision — let the actual fetch fail
    // with its own error.
    logger.debug({ err, host }, 'url policy: dns lookup failed')
    return
  }

  for (const ip of ips) {
    for (const cidr of blocked) {
      if (ipInCidr(ip, cidr)) {
        throw new LinkedFilesErrors.UrlPolicyDeniedError(
          `The URL host is in a network blocked by the site policy (${cidr})`,
          { status: 403, ip, cidr }
        )
      }
    }
  }
}

export default {
  assertUrlAllowed,
  ipInCidr,
  matchesResourceRegex,
}

export { assertUrlAllowed, ipInCidr, matchesResourceRegex }
