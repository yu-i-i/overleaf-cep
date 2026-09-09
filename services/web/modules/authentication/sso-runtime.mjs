/**
 * SSO multi-provider runtime bridge (2026-08-29).
 *
 * Design (runtime enable/disable without container restart):
 *  - At boot, each provider's passport strategy name is occupied by a
 *    disabled stub, so passport routes exist and degrade cleanly.
 *  - On **each login-attempt start** (controller `passportLogin`)
 *    `refreshSsoStrategy(type)` re-resolves the provider from the stored
 *    site settings (D7: no env fallback), re-runs the CE+ manager's
 *    `initSettings` + `passportSetup` against a capture object, and
 *    re-registers the freshly built strategy on the shared passport
 *    (`passport.use` replaces the previous instance). Disabled ⇒ the
 *    stub is put back.
 *  - passport resolves the registered strategy per request
 *    (passport/lib/middleware/authenticate.js → passport._strategy(layer)),
 *    so swapping the registered instance is safe.
 */
import logger from '@overleaf/logger'
import passport from 'passport'
import {
  getSAMLProviderConfig,
  getOIDCProviderConfig,
  getLDAPConfig
} from './ssoConfigLoader.mjs'

// Manager modules are imported LAZILY (inside refreshSsoStrategy): they
// import the authentication controllers, which in turn import THIS module
// (for refreshSsoStrategy) — a static import of them here would create an
// ESM evaluation cycle (TDZ ReferenceError at boot, 2026-08-30).
const MANAGER_IMPORTS = {
  saml: () => import('./saml/app/src/SAMLModuleManager.mjs'),
  oidc: () => import('./oidc/app/src/OIDCModuleManager.mjs'),
  ldap: () => import('./ldap/app/src/LDAPModuleManager.mjs')
}

const PROXIES = {
  saml: {
    name: 'saml',
    getProvider: getSAMLProviderConfig
  },
  oidc: {
    name: 'openidconnect',
    getProvider: getOIDCProviderConfig
  },
  ldap: {
    name: 'ldapauth',
    getProvider: getLDAPConfig
  }
}

/** Passport strategy that fails cleanly when the provider is not enabled. */
function disabledStub (strategyName) {
  return {
    name: strategyName,
    authenticate (req) {
      const message = 'This SSO login option is not enabled.'
      if (typeof this.fail === 'function') {
        const fail = this.fail
        return fail.call(this, { message })
      }
      if (typeof this.error === 'function') {
        const error = this.error
        return error.call(this, new Error(message))
      }
      return null
    }
  }
}

/**
 * Re-register `type`'s strategy from the current stored config.
 * Returns true when a live strategy is in place.
 */
export async function refreshSsoStrategy (type) {
  const proxy = PROXIES[type]
  if (!proxy) throw new Error(`unknown SSO provider: ${type}`)
  const { default: manager } = await MANAGER_IMPORTS[type]()

  let provider = null
  try {
    provider = await proxy.getProvider()
  } catch (err) {
    logger.warn({ err, type }, 'sso refresh: config resolution failed; provider disabled')
  }
  if (!provider) {
    passport.use(disabledStub(proxy.name))
    return false
  }

  try {
    await manager.initSettings()
    let captured = null
    await new Promise((resolve, reject) => {
      manager.passportSetup(
        { use: strategy => { captured = strategy } },
        err => (err ? reject(err) : resolve())
      )
    })
    if (!captured) {
      logger.info({ type }, 'sso refresh: manager built no strategy; provider disabled')
      passport.use(disabledStub(proxy.name))
      return false
    }
    passport.use(captured)
    return true
  } catch (err) {
    logger.warn({ err, type }, 'sso refresh: strategy build failed; provider disabled')
    passport.use(disabledStub(proxy.name))
    return false
  }
}

/** A disabled passport strategy for `type` (clean fail message). */
export function disabledSsoStrategy (type) {
  const proxy = PROXIES[type]
  if (!proxy) throw new Error(`unknown SSO provider: ${type}`)
  return disabledStub(proxy.name)
}

/** Boot hook: register a clean disabled stub for every provider. */
export async function setupSsoRuntime (callback) {
  for (const [type, proxy] of Object.entries(PROXIES)) {
    try {
      passport.use(disabledStub(proxy.name))
    } catch (err) {
      logger.warn({ err, type }, 'sso boot: stub registration failed')
    }
  }
  return callback(null)
}

export function isSsoProviderEnabledForType (type) {
  const proxy = PROXIES[type]
  return proxy ? Promise.resolve(proxy.getProvider()).then(p => !!p) : Promise.resolve(false)
}
