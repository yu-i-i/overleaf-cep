import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import Settings from '@overleaf/settings'
import _ from 'lodash'
import { URL } from 'node:url'
import Path from 'node:path'
import moment from 'moment'
import { fetchJson } from '@overleaf/fetch-utils'
import contentDisposition from 'content-disposition'
import Features from './Features.js'
import SessionManager from '../Features/Authentication/SessionManager.js'
import PackageVersions from './PackageVersions.js'
import Modules from './Modules.js'
import Errors from '../Features/Errors/Errors.js'

import {
  canRedirectToAdminDomain,
  hasAdminAccess,
  useAdminCapabilities,
  useHasAdminCapability,
} from '../Features/Helpers/AdminAuthorizationHelper.js'

import { addOptionalCleanupHandlerAfterDrainingConnections } from './GracefulShutdown.js'
import { sanitizeSessionUserForFrontEnd } from './FrontEndUser.mjs'
import { expressify } from '@overleaf/promise-utils'

const IEEE_BRAND_ID = Settings.ieeeBrandId

let webpackManifest
async function loadManifest() {
  switch (process.env.NODE_ENV) {
    case 'production':
      /* eslint-disable import/no-unresolved */
      // Only load webpack manifest file in production.
      webpackManifest = (
        await import('../../../public/manifest.json', {
          with: { type: 'json' },
        })
      ).default
      /* eslint-enable import/no-unresolved */
      break
    case 'development': {
      // In dev, fetch the manifest from the webpack container.
      loadManifestFromWebpackDevServer()
      const intervalHandle = setInterval(
        loadManifestFromWebpackDevServer,
        10 * 1000
      )
      addOptionalCleanupHandlerAfterDrainingConnections(
        'refresh webpack manifest',
        () => {
          clearInterval(intervalHandle)
        }
      )
      break
    }
    default:
      // In ci, all entries are undefined.
      webpackManifest = {}
  }
}
function loadManifestFromWebpackDevServer(done = function () {}) {
  fetchJson(new URL(`/manifest.json`, Settings.apis.webpack.url), {
    headers: {
      Host: 'localhost',
    },
  })
    .then(json => {
      webpackManifest = json
      done()
    })
    .catch(error => {
      logger.err({ error }, 'cannot fetch webpack manifest')
      done(error)
    })
}
const IN_CI = process.env.NODE_ENV === 'test'
function getWebpackAssets(entrypoint, section) {
  if (IN_CI) {
    // Emit an empty list of entries in CI.
    return []
  }
  return webpackManifest.entrypoints[entrypoint].assets[section] || []
}

export default async function (webRouter, privateApiRouter, publicApiRouter) {
  await loadManifest()
  if (process.env.NODE_ENV === 'development') {
    // In the dev-env, delay requests until we fetched the manifest once.
    webRouter.use(function (req, res, next) {
      if (!webpackManifest) {
        loadManifestFromWebpackDevServer(next)
      } else {
        next()
      }
    })
  }

  webRouter.use(function (req, res, next) {
    res.locals.session = req.session
    next()
  })

  function addSetContentDisposition(req, res, next) {
    res.setContentDisposition = function (type, { filename }) {
      res.setHeader(
        'Content-Disposition',
        contentDisposition(filename, { type })
      )
    }
    next()
  }
  webRouter.use(addSetContentDisposition)
  privateApiRouter.use(addSetContentDisposition)
  publicApiRouter.use(addSetContentDisposition)

  webRouter.use(function (req, res, next) {
    req.externalAuthenticationSystemUsed =
      () => !!req?.user?.externalAuth
    res.locals.externalAuthenticationSystemUsed =
      () => !!req?.user?.externalAuth
    req.hasFeature = res.locals.hasFeature = Features.hasFeature
    next()
  })

  webRouter.use(function (req, res, next) {
    let staticFilesBase

    const cdnAvailable =
      Settings.cdn && Settings.cdn.web && !!Settings.cdn.web.host
    const cdnBlocked =
      req.query.nocdn === 'true' || req.session.cdnBlocked || false
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (cdnBlocked && req.session.cdnBlocked == null) {
      logger.debug(
        { userId, ip: req != null ? req.ip : undefined },
        'cdnBlocked for user, not using it and turning it off for future requets'
      )
      Metrics.inc('no_cdn', 1, {
        path: userId ? 'logged-in' : 'pre-login',
        method: 'true',
      })
      req.session.cdnBlocked = true
    }
    Metrics.inc('cdn_blocked', 1, {
      path: userId ? 'logged-in' : 'pre-login',
      method: String(cdnBlocked),
    })
    const host = req.headers && req.headers.host
    const isSmoke = host.slice(0, 5).toLowerCase() === 'smoke'
    if (cdnAvailable && !isSmoke && !cdnBlocked) {
      staticFilesBase = Settings.cdn.web.host
    } else {
      staticFilesBase = ''
    }

    res.locals.buildBaseAssetPath = function () {
      // Return the base asset path (including the CDN url) so that webpack can
      // use this to dynamically fetch scripts (e.g. PDFjs worker)
      return staticFilesBase + '/'
    }

    res.locals.buildJsPath = function (jsFile) {
      return staticFilesBase + webpackManifest[jsFile]
    }

    res.locals.buildCopiedJsAssetPath = function (jsFile) {
      return staticFilesBase + (webpackManifest[jsFile] || '/' + jsFile)
    }

    let runtimeEmitted = false
    const runtimeChunk = webpackManifest['runtime.js']
    res.locals.entrypointScripts = function (entrypoint) {
      // Each "entrypoint" contains the runtime chunk as imports.
      // Loading the entrypoint twice results in broken execution.
      let chunks = getWebpackAssets(entrypoint, 'js')
      if (runtimeEmitted) {
        chunks = chunks.filter(chunk => chunk !== runtimeChunk)
      }
      runtimeEmitted = true
      return chunks.map(chunk => staticFilesBase + chunk)
    }

    res.locals.entrypointStyles = function (entrypoint) {
      const chunks = getWebpackAssets(entrypoint, 'css')
      return chunks.map(chunk => staticFilesBase + chunk)
    }

    res.locals.mathJaxPath = `/js/libs/mathjax-${PackageVersions.version.mathjax}/es5/tex-svg-full.js`
    res.locals.dictionariesRoot = `/js/dictionaries/${PackageVersions.version.dictionaries}/`

    res.locals.lib = PackageVersions.lib

    res.locals.moment = moment

    res.locals.buildStylesheetPath = function (cssFileName) {
      return staticFilesBase + webpackManifest[cssFileName]
    }

    res.locals.buildCssPath = function () {
      return res.locals.buildStylesheetPath('main-style.css')
    }

    res.locals.buildImgPath = function (imgFile) {
      const path = Path.join('/img/', imgFile)
      return staticFilesBase + path
    }

    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.translate = req.i18n.translate

    const addTranslatedTextDeep = obj => {
      if (_.isObject(obj)) {
        if (_.has(obj, 'text')) {
          obj.translatedText = req.i18n.translate(obj.text)
        }
        _.forOwn(obj, value => {
          addTranslatedTextDeep(value)
        })
      }
    }

    // This function is used to add translations from the server for main
    // navigation and footer items because it's tricky to get them in the front
    // end otherwise.
    res.locals.cloneAndTranslateText = obj => {
      const clone = _.cloneDeep(obj)
      addTranslatedTextDeep(clone)
      return clone
    }

    // Don't include the query string parameters, otherwise Google
    // treats ?nocdn=true as the canonical version
    try {
      const parsedOriginalUrl = new URL(req.originalUrl, Settings.siteUrl)
      res.locals.currentUrl = parsedOriginalUrl.pathname
      res.locals.currentUrlWithQueryParams =
        parsedOriginalUrl.pathname + parsedOriginalUrl.search
    } catch (err) {
      return next(new Errors.InvalidError())
    }
    res.locals.capitalize = function (string) {
      if (string.length === 0) {
        return ''
      }
      return string.charAt(0).toUpperCase() + string.slice(1)
    }
    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.getUserEmail = function () {
      const user = SessionManager.getSessionUser(req.session)
      const email = (user != null ? user.email : undefined) || ''
      return email
    }
    next()
  })

  webRouter.use(
    expressify(async function (req, res, next) {
      res.locals.StringHelper = (
        await import('../Features/Helpers/StringHelper.js')
      ).default
      next()
    })
  )

  webRouter.use(function (req, res, next) {
    res.locals.csrfToken = req != null ? req.csrfToken() : undefined
    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.getReqQueryParam = field =>
      req.query != null ? req.query[field] : undefined
    next()
  })

  webRouter.use(function (req, res, next) {
    const currentUser = SessionManager.getSessionUser(req.session)
    if (currentUser != null) {
      res.locals.user = sanitizeSessionUserForFrontEnd(currentUser)
    }
    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.getLoggedInUserId = () =>
      SessionManager.getLoggedInUserId(req.session)
    res.locals.getSessionUser = () => SessionManager.getSessionUser(req.session)
    res.locals.canRedirectToAdminDomain = () =>
      canRedirectToAdminDomain(SessionManager.getSessionUser(req.session))
    res.locals.hasAdminAccess = () =>
      hasAdminAccess(SessionManager.getSessionUser(req.session))
    next()
  })

  webRouter.use(useAdminCapabilities)

  webRouter.use(useHasAdminCapability)

  webRouter.use(function (req, res, next) {
    // Clone the nav settings so they can be modified for each request
    res.locals.nav = {}
    for (const key in Settings.nav) {
      res.locals.nav[key] = _.clone(Settings.nav[key])
    }
    res.locals.templates = Settings.templateLinks
    next()
  })

  webRouter.use(function (req, res, next) {
    if (Settings.reloadModuleViewsOnEachRequest) {
      Modules.loadViewIncludes(req.app)
    }
    res.locals.moduleIncludes = Modules.moduleIncludes
    res.locals.moduleIncludesAvailable = Modules.moduleIncludesAvailable
    next()
  })

  webRouter.use(function (req, res, next) {
    // TODO
    if (Settings.overleaf != null) {
      res.locals.overallThemes = [
        {
          name: 'Dark',
          val: '',
        },
        {
          name: 'Light',
          val: 'light-',
        },
        {
          name: 'System',
          val: 'system',
        },
      ]
    }
    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.settings = Settings
    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.showThinFooter = !Features.hasFeature('saas')
    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.websiteRedesignOverride = req.query.redesign === 'enabled'
    next()
  })

  webRouter.use(function (req, res, next) {
    res.locals.ExposedSettings = {
      isOverleaf: Settings.overleaf != null,
      appName: Settings.appName,
      adminEmail: Settings.adminEmail,
      dropboxAppName:
        Settings.apis.thirdPartyDataStore?.dropboxAppName || 'Overleaf',
      ieeeBrandId: IEEE_BRAND_ID,
      hasSamlBeta: req.session.samlBeta,
      hasAffiliationsFeature: Features.hasFeature('affiliations'),
      hasSamlFeature: Features.hasFeature('saml'),
      samlInitPath: _.get(Settings, ['saml', 'ukamf', 'initPath']),
      hasLinkUrlFeature: Features.hasFeature('link-url'),
      hasLinkedProjectFileFeature: Features.hasFeature('linked-project-file'),
      hasLinkedProjectOutputFileFeature: Features.hasFeature(
        'linked-project-output-file'
      ),
      siteUrl: Settings.siteUrl,
      emailConfirmationDisabled: Settings.emailConfirmationDisabled,
      maxEntitiesPerProject: Settings.maxEntitiesPerProject,
      maxUploadSize: Settings.maxUploadSize,
      projectUploadTimeout: Settings.projectUploadTimeout,
      recaptchaSiteKey: Settings.recaptcha?.siteKey,
      recaptchaSiteKeyV3: Settings.recaptcha?.siteKeyV3,
      recaptchaDisabled: Settings.recaptcha?.disabled,
      textExtensions: Settings.textExtensions,
      editableFilenames: Settings.editableFilenames,
      validRootDocExtensions: Settings.validRootDocExtensions,
      fileIgnorePattern: Settings.fileIgnorePattern,
      sentryAllowedOriginRegex: Settings.sentry.allowedOriginRegex,
      sentryDsn: Settings.sentry.publicDSN,
      sentryEnvironment: Settings.sentry.environment,
      sentryRelease: Settings.sentry.release,
      hotjarId: Settings.hotjar?.id,
      hotjarVersion: Settings.hotjar?.version,
      enableSubscriptions: Settings.enableSubscriptions,
      gaToken:
        Settings.analytics &&
        Settings.analytics.ga &&
        Settings.analytics.ga.token,
      gaTokenV4:
        Settings.analytics &&
        Settings.analytics.ga &&
        Settings.analytics.ga.tokenV4,
      propensityId: Settings?.analytics?.propensity?.id,
      cookieDomain: Settings.cookieDomain,
      templateLinks: Settings.templateLinks,
      labsEnabled: Settings.labs && Settings.labs.enable,
      wikiEnabled: Settings.overleaf != null || Settings.proxyLearn,
      templatesEnabled:
        Settings.overleaf != null || Settings.templates?.user_id != null,
      cioWriteKey: Settings.analytics?.cio?.writeKey,
      cioSiteId: Settings.analytics?.cio?.siteId,
    }
    next()
  })
}
