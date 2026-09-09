#!/usr/bin/env node
/**
 * tools/restore-site-settings.mjs (2026-08-31, R12 P0)
 *
 * Restores the admin-managed site settings (`sharelatex.site_settings`,
 * doc _id "global") via the web admin API, using values reconstructed
 * from the deployment files + the live test IdPs:
 *
 *   /data_1/docker/compose_cep/.env
 *   /data_1/docker/compose_cep/overleafserver/compose.yaml.bak-sp
 *   services/web/modules/admin-tools (SSO_TEST_ENV_README.md values)
 *
 * Idempotent: re-running re-PUTs the same values. Sections that already
 * hold good values (e.g. `templates`, saved by the admin) are left alone
 * unless RESTORE_ALL=1. Secrets are read from the host files at run time
 * and are never printed.
 */
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'https://psintern.neuro.uni-bremen.de'
const COMPOSE_ENV = process.env.COMPOSE_ENV || '/data_1/docker/compose_cep/.env'
const COMPOSE_BAK =
  process.env.COMPOSE_BAK ||
  '/data_1/docker/compose_cep/overleafserver/compose.yaml.bak-sp'

function parseEnvFile(file) {
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function yamlValue(backup, key) {
  const m = backup.match(new RegExp(`${key}:\\s*(.+)`, 'm'))
  return m ? m[1].trim() : ''
}

const env = parseEnvFile(COMPOSE_ENV)
const bak = fs.readFileSync(COMPOSE_BAK, 'utf8')

const SITE_URL = env.OVERLEAF_SITE_URL || BASE
const IMAGES = (yamlValue(bak, 'ALL_TEX_LIVE_DOCKER_IMAGES') || '').split(',').map(s => s.trim()).filter(Boolean)
const IMAGE_NAMES = (yamlValue(bak, 'ALL_TEX_LIVE_DOCKER_IMAGE_NAMES') || '').split(',').map(s => s.trim()).filter(Boolean)

// SAML IdP certificate from the live test IdP metadata.
let samlCert = ''
try {
  const meta = await (await fetch('http://saml:8081/saml/idp/metadata', { signal: AbortSignal.timeout(5000) })).text()
  const blocks = [...meta.matchAll(/<ds:X509Certificate>([\s\S]*?)<\/ds:X509Certificate>/g)].map(x => x[1].replace(/\s+/g, ''))
  if (blocks.length) {
    samlCert =
      '-----BEGIN CERTIFICATE-----\n' +
      blocks.join('').match(/.{1,64}/g).join('\n') +
      '\n-----END CERTIFICATE-----'
  }
} catch (err) {
  console.warn('WARN: SAML IdP metadata fetch failed:', err.message)
}

const sections = {
  email: {
    driver: 'smtp',
    host: env.OVERLEAF_EMAIL_SMTP_HOST,
    port: Number(env.OVERLEAF_EMAIL_SMTP_PORT),
    secure: env.OVERLEAF_EMAIL_SMTP_SECURE === 'true',
    user: env.OVERLEAF_EMAIL_SMTP_USER,
    pass: env.OVERLEAF_EMAIL_PASSWORD || '',
    fromAddress: env.OVERLEAF_EMAIL_FROM_ADDRESS,
    skipConfirmation: true,
    sesRegion: '',
    sesSecret: '',
  },
  'sso-saml': {
    enabled: true,
    identityServiceName: 'Log in with Test SAML',
    issuer: 'MyOverleaf',
    entryPoint: 'http://saml:8081/saml/idp/SSOService',
    audience: 'MyOverleaf',
    callbackURL: `${SITE_URL}/saml/login/callback`,
    idpCert: samlCert,
    privateKey: '',
    decryptionPvk: '',
    wantAssertionsSigned: true,
  },
  'sso-oidc': {
    enabled: true,
    identityServiceName: 'Log in with Test OIDC',
    issuer: 'http://oidc:8080/sso/realms/master',
    authorizationURL: 'http://oidc:8080/sso/realms/master/protocol/openid-connect/auth',
    tokenURL: 'http://oidc:8080/sso/realms/master/protocol/openid-connect/token',
    userInfoURL: 'http://oidc:8080/sso/realms/master/protocol/openid-connect/userinfo',
    logoutURL: 'http://oidc:8080/sso/realms/master/protocol/openid-connect/logout',
    clientID: 'overleaf_test',
    clientSecret: 'SOMEPASSWORD',
    scope: 'openid profile email',
  },
  'sso-ldap': {
    enabled: true,
    identityServiceName: 'Log in with Test LDAP',
    url: 'ldap://ldap:389',
    searchBase: 'dc=example,dc=com',
    bindDN: 'cn=admin,dc=example,dc=com',
    bindCredentials: 'admin_password',
    searchFilter: '(mail={{username}})',
    searchScope: 'sub',
    placeholder: '',
    emailAtt: 'mail',
    firstNameAtt: 'givenName',
    lastNameAtt: 'sn',
    isAdminAtt: '',
    updateUserDetailsOnLogin: true,
  },
  'sandboxed-compiles': {
    enabled: true,
    dockerRunner: true,
    hostDir: yamlValue(bak, 'SANDBOXED_COMPILES_HOST_DIR') || '/data_1/docker/compose_cep/overleafserver/data/data/compiles',
    socketPath: '/var/run/docker.sock',
    extraFlags: '',
    imageUser: yamlValue(bak, 'TEXLIVE_IMAGE_USER') || 'www-data',
    defaultImage: IMAGES[0] || '',
    images: IMAGES.map((image, i) => ({ image, name: IMAGE_NAMES[i] || image })),
  },
  zotero: {
    enabled: true,
    clientKey: yamlValue(bak, 'ZOTERO_CLIENT_KEY') || '',
    clientSecret: yamlValue(bak, 'ZOTERO_CLIENT_SECRET') || '',
  },
  'git-integration': {
    enabled: true,
    host: yamlValue(bak, 'GIT_BRIDGE_HOST') || 'git-bridge',
    port: Number(yamlValue(bak, 'GIT_BRIDGE_PORT') || 8000),
  },
  'github-sync': {
    enabled: true,
    clientId: yamlValue(bak, 'GITHUB_SYNC_CLIENT_ID') || '',
    clientID: yamlValue(bak, 'GITHUB_SYNC_CLIENT_ID') || '',
    clientSecret: yamlValue(bak, 'GITHUB_SYNC_CLIENT_SECRET') || '',
    cipherFile: '',
    cipherLabel: '',
  },
  pandoc: {
    enabled: true,
    image: yamlValue(bak, 'PANDOC_IMAGE') || 'sharelatex/sharelatex-pandoc:6.2.0',
  },
  'linked-file-types': {
    enabledTypes: (yamlValue(bak, 'ENABLED_LINKED_FILE_TYPES') || 'project_file,project_output_file,url,zotero').split(',').map(s => s.trim()).filter(Boolean),
  },
  externalUrl: {
    enabled: true,
    blockedNetworks: [],
    allowedResourcesRegex: '',
  },
  signup: {
    enabled: true,
    allowedEmailDomains: ['*'],
    disabledRedirectUrl: '',
  },
}

if (!fs.existsSync(COMPOSE_ENV) || !fs.existsSync(COMPOSE_BAK)) {
  console.error('FATAL: compose .env or compose.yaml.bak-sp missing (run on the dev host)')
  process.exit(2)
}
if (!samlCert) console.warn('WARN: saml idpCert is empty — SAML login may fail verification')
if (!imagesSanity(sections['sandboxed-compiles'].images)) process.exit(2)

function imagesSanity(list) {
  return Array.isArray(list) && list.length > 0 && list.every(r => r && r.image)
}

// ---- browser (CDP) ----------------------------------------------
process.env.CDP_PROFILE = '/tmp/cdp-restore-' + Date.now()
process.env.CDP_PORT = '9620'
import { pathToFileURL } from 'node:url'
const cdpDriver = pathToFileURL(
  new URL('../services/web/modules/bib-editor/test/e2e/cdp.mjs', import.meta.url).pathname
)
const { start, stop } = await import(cdpDriver.href)
const RECOVERY_EMAIL = process.env.RESTORE_USER_EMAIL
const RECOVERY_PASS = process.env.RESTORE_USER_PASS
if (!RECOVERY_EMAIL || !RECOVERY_PASS) {
  console.error('FATAL: set RESTORE_USER_EMAIL and RESTORE_USER_PASS (site admin account)')
  process.exit(2)
}
const b = await start()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const tab = await b.newTab(BASE + '/login')
const ev = async e => b.evalIn(tab, e, { awaitPromise: true, returnByValue: true })

await sleep(2500)
await ev(`(() => { const u = document.querySelector('input[name=email]'); const set = (el,v) => { const s = Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set; s.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})) }; set(u, ${JSON.stringify(RECOVERY_EMAIL)}); set(document.querySelector('input[name=password]'), ${JSON.stringify(RECOVERY_PASS)}); u.closest('form').requestSubmit(); return true })()`)
for (let i = 0; i < 20; i++) {
  await sleep(500)
  if (String(await ev('location.href')).indexOf('login') === -1) break
}
if (String(await ev('location.href')).includes('login')) { throw new Error('restore: login failed') }

await ev(`window.__csrf = (document.querySelector('[name=ol-csrfToken]') || {}).content || ''`)
const csrf = String(await ev('window.__csrf') || '')

const skip = process.env.RESTORE_ALL === '1'
  ? []
  : (await ev(`fetch('/admin/site-settings', { headers: { accept: 'application/json' } }).then(async r => { const d = await r.json(); return Object.entries(d).filter(([k, v]) => k !== 'templates' && v && v.enabled === true && k !== 'externalUrl' && k !== 'signup' && k !== 'linked-file-types').map(([k]) => k) }).catch(() => [])`))

console.log('Existing enabled sections (skipped unless RESTORE_ALL=1):', skip.join(', ') || '(none)')

let fails = 0
for (const [name, body] of Object.entries(sections)) {
  if (skip.includes(name)) {
    console.log(`. ${name.padEnd(20)} skipped (already enabled)`)
    continue
  }
  const res = await ev(`(async () => { const r = await fetch('/admin/site-settings/' + ${JSON.stringify(name)}, { method: 'PUT', headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Csrf-Token': window.__csrf }, body: JSON.stringify(${JSON.stringify(body)}) }); return r.status + ' ' + (await r.text()).slice(0, 120) })()`)
  const ok = String(res).startsWith('200')
  if (!ok) fails++
  console.log(`${ok ? 'OK' : '!!'} ${name.padEnd(20)} ${res.slice(0, 60)}`)
}

// ---- verify ------------------------------------------------------
const verify = await ev(`fetch('/admin/site-settings', { headers: { accept: 'application/json' } }).then(async r => {
  const d = await r.json()
  const checks = {
    'email.host': d.email && d.email.host,
    'email.from': d.email && d.email.fromAddress,
    'sso-saml.enabled': d['sso-saml'] && d['sso-saml'].enabled,
    'sso-saml.entryPoint': d['sso-saml'] && d['sso-saml'].entryPoint,
    'sso-oidc.enabled': d['sso-oidc'] && d['sso-oidc'].enabled,
    'sso-oidc.clientID': d['sso-oidc'] && d['sso-oidc'].clientID,
    'sso-ldap.enabled': d['sso-ldap'] && d['sso-ldap'].enabled,
    'sso-ldap.url': d['sso-ldap'] && d['sso-ldap'].url,
    'sandbox.enabled': d['sandboxed-compiles'] && d['sandboxed-compiles'].enabled,
    'sandbox.images': (d['sandboxed-compiles'] && (d['sandboxed-compiles'].images || []).length) || 0,
    'zotero.enabled': d.zotero && d.zotero.enabled,
    'git-integration.host': d['git-integration'] && d['git-integration'].host,
    'github-sync.enabled': d['github-sync'] && d['github-sync'].enabled,
    'pandoc.image': d.pandoc && d.pandoc.image,
    'linked-file-types': (d['linked-file-types'] && (d['linked-file-types'].enabledTypes || []).length) || 0,
    'templates.enabled': d.templates && d.templates.enabled,
    'templates.cats': (d.templates && (d.templates.categories || []).length) || 0,
  }
  return JSON.stringify(checks)
})`)
console.log('\nVERIFY ' + verify)
console.log(fails ? `\n${fails} section PUT(s) FAILED` : '\nAll sections restored')
await stop()
process.exit(fails ? 1 : 0)
