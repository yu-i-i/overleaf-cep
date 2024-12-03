import initSamlSettings from './app/src/InitSamlSettings.mjs'
import addSamlStrategy from './app/src/SamlStrategy.mjs'
import SamlRouter from './app/src/SamlRouter.mjs'
import SamlNonCsrfRouter from './app/src/SamlNonCsrfRouter.mjs'

let samlModule = {};

if (process.env.EXTERNAL_AUTH === 'saml') {
  initSamlSettings()
  samlModule = {
    name: 'saml-authentication',
    hooks: {
      passportSetup: function (passport, callback) {
        try {
          addSamlStrategy(passport)
          callback(null)
        } catch (error) {
          callback(error)
        }
      },
    },
    router: SamlRouter,
    nonCsrfRouter: SamlNonCsrfRouter,
  }
}
export default samlModule
