// CE+ logout with provider-specific SLO.
// 2026-08-30 (SSO multi-provider, D7 stored-only SSO): the boot-time
// `process.env.EXTERNAL_AUTH.includes(...)` guard crashed when EXTERNAL_AUTH
// was unset (admin-managed SSO makes that env obsolete — the env was stripped
// from compose). Controllers are now imported lazily AT LOGOUT TIME, chosen
// by the user's externalAuth marker (set by the SSO login strategies).
export default async function logout(req, res, next) {
  try {
    switch (req.user && req.user.externalAuth) {
      case 'saml': {
        const mod = await import('./saml/app/src/SAMLAuthenticationController.mjs')
        return mod.default.passportLogout(req, res, next)
      }
      case 'oidc': {
        const mod = await import('./oidc/app/src/OIDCAuthenticationController.mjs')
        return mod.default.passportLogout(req, res, next)
      }
      default:
        return next()
    }
  } catch (err) {
    if (typeof next === 'function') return next(err)
    throw err
  }
}
