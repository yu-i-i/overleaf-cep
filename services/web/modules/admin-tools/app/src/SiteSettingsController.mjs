/**
 * Admin "Manage Site" API — SiteSettings sections
 * (templates / zotero / externalUrl / signup), per the user-designed
 * admin console (BIB_ORCID_TEMPLATES_PLAN.md §2.1 + decision 3.0).
 *
 * All endpoints are site-admin only (AuthorizationMiddleware
 * .ensureUserIsSiteAdmin in the router). Secrets are masked in GET
 * responses; PUT with an empty secret field keeps the stored value.
 */
import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import {
  getSection,
  setSection,
  cleanSectionInput,
  maskSecrets,
  SECTION_VALIDATORS,
} from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import { Template } from '../../../template-gallery/app/src/models/Template.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

export default {
  /**
   * Render the Manage Site admin page (Tabs: Templates, Zotero,
   * External URLs, Sign Up).
   */
  manageSitePage: expressify(async (req, res) => {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await User.findById(userId, 'ace')

    const userSettings = await UserSettingsHelper.buildUserSettings(
      req,
      res,
      user
    )

    res.render(
      Path.resolve(__dirname, '../views/manage-site-react'),
      {
        title: 'Manage Extensions',
        userSettings,
      }
    )
  }),

  /**
   * GET /admin/site-settings — all sections (secrets masked) +
   * templates: per-category template counts.
   */
  getSiteSettings: expressify(async (req, res) => {
    const [templates, zotero, externalUrl, signup, ssoSaml, ssoOidc, ssoLdap, sandboxedCompiles, gitIntegration, githubSync, email, linkedFileTypes, pandoc, misc] = await Promise.all([
      getSection('templates', Settings),
      getSection('zotero', Settings),
      getSection('externalUrl', Settings),
      getSection('signup', Settings),
      getSection('sso-saml', Settings),
      getSection('sso-oidc', Settings),
      getSection('sso-ldap', Settings),
      getSection('sandboxed-compiles', Settings),
      getSection('git-integration', Settings),
      getSection('github-sync', Settings),
      getSection('email', Settings),
      getSection('linked-file-types', Settings),
      getSection('pandoc', Settings),
      getSection('misc', Settings),
    ])

    // Template counts per category (same source as the gallery).
    const counts = {}
    const categories = templates.categories || []
    await Promise.all(
      categories.map(async (cat) => {
        const query =
          cat.key === 'all' ? {} : { category: `/templates/${cat.key}` }
        try {
          counts[cat.key] = await Template.countDocuments(query).exec()
        } catch (err) {
          logger.warn({ err, key: cat.key }, 'site-settings: template count failed')
          counts[cat.key] = null
        }
      })
    )

    res.json({
      templates: { ...maskSecrets('templates', templates), counts },
      zotero: maskSecrets('zotero', zotero),
      externalUrl: maskSecrets('externalUrl', externalUrl),
      signup: maskSecrets('signup', signup),
      'sso-saml': maskSecrets('sso-saml', ssoSaml),
      'sso-oidc': maskSecrets('sso-oidc', ssoOidc),
      'sso-ldap': maskSecrets('sso-ldap', ssoLdap),
      'sandboxed-compiles': maskSecrets('sandboxed-compiles', sandboxedCompiles),
      'git-integration': maskSecrets('git-integration', gitIntegration),
      'github-sync': maskSecrets('github-sync', githubSync),
      email: maskSecrets('email', email),
      'linked-file-types': maskSecrets('linked-file-types', linkedFileTypes),
      pandoc: maskSecrets('pandoc', pandoc),
      misc: maskSecrets('misc', misc),
    })
  }),

  /**
   * PUT /admin/site-settings/:section — replace one section
   * (validated; secrets encrypted at rest).
   */
  updateSiteSettings: expressify(async (req, res) => {
    const section = req.params.section
    const validator = SECTION_VALIDATORS[section]
    if (!validator) {
      return HttpErrorHandler.unprocessableEntity(
        req,
        res,
        `Unknown section: ${section}`
      )
    }
    const errors = validator(req.body)
    if (errors.length > 0) {
      return HttpErrorHandler.unprocessableEntity(req, res, errors.join('; '))
    }

    const result = await setSection(
      section,
      cleanSectionInput(section, req.body)
    )
    logger.info(
      { section, result, userId: req.session?.user?.id },
      'site-settings: section updated'
    )
    // SSO: re-register the passport strategy from the new stored config so
    // the change applies without a container restart (best effort — the
    // login start also refreshes).
    const ssoType = section === 'sso-saml' ? 'saml'
      : section === 'sso-oidc' ? 'oidc'
        : section === 'sso-ldap' ? 'ldap' : null
    if (ssoType) {
      try {
        const runtime = await import('../../../authentication/sso-runtime.mjs')
        await runtime.refreshSsoStrategy(ssoType)
      } catch (err) {
        logger.warn({ err, section }, 'site-settings: SSO strategy refresh failed')
      }
    }
    res.json({ ok: true, ...result })
  }),
}
