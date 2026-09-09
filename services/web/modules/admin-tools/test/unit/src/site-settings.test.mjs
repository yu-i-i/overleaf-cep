import { expect } from 'chai'

// Hermetic unit tests (added 2026-08-28): point the manager at a dedicated
// database so the LIVE site_settings document (stored-wins semantics)
// cannot leak into the env-seed tests. This env MUST be set before the
// manager's mongodb import is evaluated → dynamic import (ESM static
// imports are hoisted and would run first).
process.env.MONGO_URL = 'mongodb://127.0.0.1:27017/site-settings-unit'

const {
  DEFAULT_TEMPLATE_CATEGORIES,
  validateTemplatesSection,
  validateZoteroSection,
  validateExternalUrlSection,
  validateSignupSection,
  SECTION_VALIDATORS,
  maskSecrets,
  validateSandboxedCompilesSection,
  validateGitIntegrationSection,
  validateGithubSyncSection,
  validateEmailSection,
  validateLinkedFileTypesSection,
  validatePandocSection,
  validateMiscSection,
  getSection,
} = await import('../../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs')
const {
  encryptText,
  decryptText,
} = await import('../../../../../app/src/Features/SiteSettings/SecretCipher.mjs')
globalThis.__ssm = await import('../../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs')
const { default: mongodb } = await import('mongodb-legacy')
const { MongoClient } = mongodb

const unitDb = new MongoClient(process.env.MONGO_URL).db()

describe('SiteSettings', () => {
  function assertUnitDb (label) {
    // P0 (2026-08-31): never run destructive cleanup against the live DB.
    const url = String(process.env.MONGO_URL || '').split('?')[0]
    const dbMatch = url.match(/\/([^/?#]+)/)
    const dbName = dbMatch ? dbMatch[1] : ''
    if (!dbName || dbName === 'sharelatex') {
      throw new Error(
        `TEST GUARD (${label}): refusing destructive cleanup — MONGO_URL ` +
        `resolves to the LIVE database '${dbName}' (expected a unit db).`
      )
    }
    return dbName
  }

  it('cleans a pre-existing unit test collection (hermetic start)', async () => {
    assertUnitDb('hermetic start')
    await unitDb.collection('site_settings').deleteMany({})
  })
  describe('DEFAULT_TEMPLATE_CATEGORIES', () => {
    it('carries the manual’s 12 example categories with names/descriptions', () => {
      const cats = DEFAULT_TEMPLATE_CATEGORIES
      expect(cats).to.have.length(12)
      expect(
        cats.map(c => c.key)
      ).to.have.members([
        'academic-journal',
        'book',
        'presentation',
        'poster',
        'cv',
        'homework',
        'bibliography',
        'calendar',
        'formal-letter',
        'report',
        'thesis',
        'newsletter',
      ])
      for (const c of cats) {
        expect(c.name, c.key).to.be.a('string').that.is.not.empty
        expect(c.description, c.key).to.be.a('string').that.is.not.empty
      }
    })
  })

  describe('validators', () => {
    it('accepts a valid templates section', () => {
      const errors = validateTemplatesSection({
        enabled: true,
        categories: [
          { key: 'thesis', enabled: true, name: 'Theses', description: 'd', publishable: true },
        ],
      })
      expect(errors).to.deep.equal([])
    })

    it('rejects bad templates sections', () => {
      expect(validateTemplatesSection('x').length).to.be.greaterThan(0)
      expect(
        validateTemplatesSection({ enabled: 'yes' }).length
      ).to.be.greaterThan(0)
      expect(
        validateTemplatesSection({
          enabled: true,
          categories: [{ key: 'UPPER', name: 'x', description: '' }],
        }).length
      ).to.be.greaterThan(0)
      expect(
        validateTemplatesSection({
          enabled: true,
          categories: [
            { key: 'a', name: 'A', description: '' },
            { key: 'a', name: 'A2', description: '' },
          ],
        }).length
      ).to.be.greaterThan(0)
    })

    it('validates blocked network CIDRs and the allowed-resources regex', () => {
      expect(
        validateExternalUrlSection({
          enabled: true,
          blockedNetworks: ['10.0.0.0/8', '192.168.0.0/16', '::1/128', '2001:db8::/32'],
          allowedResourcesRegex: '.*\\.uni-bremen\\.de/.*',
        })
      ).to.deep.equal([])
      expect(
        validateExternalUrlSection({
          enabled: false,
          blockedNetworks: ['not-a-cidr'],
        }).length
      ).to.be.greaterThan(0)
      expect(
        validateExternalUrlSection({
          enabled: false,
          allowedResourcesRegex: '(',
        }).length
      ).to.be.greaterThan(0)
    })

    it('validates the signup and zotero sections', () => {
      expect(
        validateSignupSection({
          enabled: true,
          allowedEmailDomains: ['example.org', '*.uni-bremen.de'],
        })
      ).to.deep.equal([])
      expect(
        validateSignupSection({
          enabled: false,
          allowedEmailDomains: ['no spaces or dots..'],
        }).length
      ).to.be.greaterThan(0)
      expect(
        validateZoteroSection({
          enabled: true,
          clientKey: 'abc-123',
        })
      ).to.deep.equal([])
      expect(
        validateZoteroSection({ enabled: true, clientKey: 'bad key!' }).length
      ).to.be.greaterThan(0)
    })

    it('keeps per-section validators registered', () => {
      expect(Object.keys(SECTION_VALIDATORS).sort()).to.deep.equal([
        'email',
        'externalUrl',
        'git-integration',
        'github-sync',
        'linked-file-types',
        'misc',
        'pandoc',
        'sandboxed-compiles',
        'signup',
        'sso-ldap',
        'sso-oidc',
        'sso-saml',
        'templates',
        'zotero',
      ])
    })
  })

  describe('R9 §7.2 section validators (2026-08-29)', () => {
    it('sandboxed compiles: image table rules (D4)', () => {
      expect(
        validateSandboxedCompilesSection({
          enabled: true,
          images: [{ image: 'a:1' }, { image: 'b:2', name: 'B' }],
          defaultImage: 'a:1'
        })
      ).to.deep.equal([])
      expect(
        validateSandboxedCompilesSection({ enabled: true, images: [] }).length
      ).to.be.greaterThan(0)
      expect(
        validateSandboxedCompilesSection({
          enabled: true,
          images: [{ image: 'a:1' }, { image: 'a:1' }]
        }).length
      ).to.be.greaterThan(0)
    })

    it('git integration: host + port bounds', () => {
      expect(
        validateGitIntegrationSection({ enabled: true, host: 'git-bridge', port: 8000 })
      ).to.deep.equal([])
      expect(
        validateGitIntegrationSection({ enabled: true, host: '' }).length
      ).to.be.greaterThan(0)
      expect(
        validateGitIntegrationSection({ enabled: true, host: 'h', port: 0 }).length
      ).to.be.greaterThan(0)
    })

    it('github sync: clientID required when enabled', () => {
      expect(
        validateGithubSyncSection({ enabled: false, clientID: '' })
      ).to.deep.equal([])
      process.env.GITHUB_SYNC_CLIENT_SECRET = 'env-secret'
      try {
        expect(
          validateGithubSyncSection({ enabled: true, clientID: 'id', clientSecret: '' })
        ).to.deep.equal([])
      } finally {
        delete process.env.GITHUB_SYNC_CLIENT_SECRET
      }
    })

    it('email: driver-specific required fields', () => {
      expect(
        validateEmailSection({ driver: 'smtp', host: 'smtp.x', port: 587 })
      ).to.deep.equal([])
      expect(
        validateEmailSection({ driver: 'smtp', host: '' }).length
      ).to.be.greaterThan(0)
      process.env.EMAIL_SES_SECRET_ACCESS_KEY = 'env-sec'
      try {
        expect(
          validateEmailSection({
            driver: 'ses',
            accessKeyId: 'AK',
            sesSecret: '',
            sesRegion: 'eu-central-1'
          })
        ).to.deep.equal([])
      } finally {
        delete process.env.EMAIL_SES_SECRET_ACCESS_KEY
      }
      expect(
        validateEmailSection({ driver: 'carrier-pigeon' }).length
      ).to.be.greaterThan(0)
    })

    it('linked file types: D5 fixed pair enforced, url not', () => {
      expect(
        validateLinkedFileTypesSection({
          enabledTypes: ['project_file', 'project_output_file']
        })
      ).to.deep.equal([])
      expect(
        validateLinkedFileTypesSection({
          enabledTypes: ['project_file', 'project_output_file', 'zotero']
        })
      ).to.deep.equal([])
      expect(
        validateLinkedFileTypesSection({ enabledTypes: ['url'] }).length
      ).to.be.greaterThan(0)
      expect(
        validateLinkedFileTypesSection({ enabledTypes: ['nope'] }).length
      ).to.be.greaterThan(0)
    })

    it('pandoc: image required when enabled', () => {
      expect(validatePandocSection({ enabled: true, image: 'pandoc-ol:3.1.0' })).to.deep.equal([])
      expect(validatePandocSection({ enabled: true, image: '' }).length).to.be.greaterThan(0)
    })

    it('misc: booleans/ints/strings validated (2026-09-01)', () => {
      // valid
      expect(validateMiscSection({
        appName: 'My Lab',
        navHidePoweredBy: true,
        robotsNoindex: false,
        allowPublicAccess: true,
        allowAnonymousReadWriteSharing: false,
        disableLinkSharing: true,
        disableChat: false,
        projectHardDeletionDelayDays: 30,
        userHardDeletionDelayDays: 90,
        historyRestore: true,
        enablePdfCaching: false,
        maxUploadSizeMiB: 100,
        maxEntitiesPerProject: 5000,
        defaultLatexCompiler: 'pdflatex',
      })).to.deep.equal([])
      // non-boolean boolean field
      expect(validateMiscSection({ disableChat: 'yes' }).length).to.be.greaterThan(0)
      // non-integer / sub-minimum ints
      expect(validateMiscSection({ maxUploadSizeMiB: 0 }).length).to.be.greaterThan(0)
      expect(validateMiscSection({ userHardDeletionDelayDays: 1.5 }).length).to.be.greaterThan(0)
      // bad appName / compiler
      expect(validateMiscSection({ appName: '' }).length).to.be.greaterThan(0)
      expect(validateMiscSection({ defaultLatexCompiler: 'pd flatex!' }).length).to.be.greaterThan(0)
      // unknown keys are allowed by the validator (allow-listed by
      // cleanSectionInput) — the validator only checks known field types.
    })

    it('masks github-sync and email secrets (empty-keeps handled by setSection)', () => {
      const gh = maskSecrets('github-sync', { enabled: true, clientID: 'id', clientSecret: 'top' })
      expect(gh.clientSecret).to.equal('')
      expect(gh.clientSecretSet).to.equal(true)
      const em = maskSecrets('email', { driver: 'smtp', pass: 'pw', sesSecret: '' })
      expect(em.pass).to.equal('')
      expect(em.passSet).to.equal(true)
      expect(em.sesSecretSet).to.equal(false)
    })
  })

  describe('maskSecrets', () => {
    it('masks zotero.clientSecret and reports clientSecretSet', () => {
      const masked = maskSecrets('zotero', {
        enabled: true,
        clientKey: 'k',
        clientSecret: 'ss::whatever',
        extra: 1,
      })
      expect(masked.clientSecret).to.equal('')
      expect(masked.clientSecretSet).to.equal(true)
      expect(masked.clientKey).to.equal('k')
      expect(masked.extra).to.equal(1)

      const maskedEmpty = maskSecrets('zotero', {
        enabled: true,
        clientKey: 'k',
      })
      expect(maskedEmpty.clientSecret).to.equal('')
      expect(maskedEmpty.clientSecretSet).to.equal(false)
    })
  })

  describe('env seeds (stored doc missing → env wins)', () => {
    const savedEnv = {}
    const KEYS = [
      'OVERLEAF_TEMPLATE_GALLERY',
      'OVERLEAF_TEMPLATE_CATEGORIES',
      'TEMPLATE_THESIS_NAME',
      'TEMPLATE_THESIS_DESCRIPTION',
      'OVERLEAF_ZOTERO',
      'ZOTERO_CLIENT_KEY',
      'ZOTERO_CLIENT_SECRET',
      'OVERLEAF_ENABLE_REGISTRATION_PAGE',
    ]
    const setEnv = () => {
      for (const k of KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]
      }
      process.env.OVERLEAF_TEMPLATE_GALLERY = 'true'
      process.env.OVERLEAF_TEMPLATE_CATEGORIES = 'thesis'
      process.env.TEMPLATE_THESIS_NAME = 'Theses (env)'
      process.env.TEMPLATE_THESIS_DESCRIPTION = 'thesis description (env)'
      process.env.OVERLEAF_ZOTERO = 'true'
      process.env.ZOTERO_CLIENT_KEY = 'env-ckey'
      process.env.OVERLEAF_ENABLE_REGISTRATION_PAGE = 'true'
    }
    const capture = () => {
      for (const k of KEYS) {
        if (process.env[k] !== undefined) savedEnv[k] = process.env[k]
        delete process.env[k]
      }
    }

    it('seeds templates from env with the manual defaults for other categories', async () => {
      setEnv()
      const section = await getSection('templates')
      const keys = section.categories.map(c => c.key)
      // Union (user round 4): manual defaults ∪ env categories ∪ 'all' —
      // the admin table shows every supported category, not just the env
      // list; env per-key name/description still win.
      expect(keys).to.have.members([
        'academic-journal', 'book', 'presentation', 'poster', 'cv', 'homework',
        'bibliography', 'calendar', 'formal-letter', 'report', 'thesis',
        'newsletter', 'all',
      ])
      const thesis = section.categories.find(c => c.key === 'thesis')
      expect(thesis.name).to.equal('Theses (env)')
      expect(thesis.description).to.equal('thesis description (env)')
      section.categories.forEach((c) => {
        if (c.key !== 'thesis' && c.key !== 'all') {
          expect([c.name, c.description]).to.not.deep.equal([undefined, undefined])
        }
      })
      expect(section.enabled).to.equal(true)
      capture()

      // no env categories → all 12 manual defaults + 'all'
      delete process.env.OVERLEAF_TEMPLATE_CATEGORIES
      const section2 = await getSection('templates')
      expect(section2.categories).to.have.length(13)
      const book = section2.categories.find(c => c.key === 'book')
      expect(book.name).to.equal('Books')
      expect(book.description).to.include('book')
      capture()
    })

    it('seeds zotero from env including the plaintext secret (never stored)', async () => {
      setEnv()
      process.env.ZOTERO_CLIENT_SECRET = 'env-secret'
      const section = await getSection('zotero')
      expect(section.enabled).to.equal(true)
      expect(section.clientKey).to.equal('env-ckey')
      expect(section.clientSecret).to.equal('env-secret')
      // masked view hides the secret
      const masked = maskSecrets('zotero', section)
      expect(masked.clientSecret).to.equal('')
      expect(masked.clientSecretSet).to.equal(true)
      capture()
    })

    it('seeds signup from env', async () => {
      setEnv()
      const section = await getSection('signup')
      expect(section.enabled).to.equal(true)
      capture()
    })

    it('seeds signup.disabledRedirectUrl (New 1) and keeps stored value', async () => {
      setEnv()
      process.env.OVERLEAF_REGISTRATION_DISABLED_REDIRECT = '/custom'
      const section = await getSection('signup')
      expect(section.disabledRedirectUrl).to.equal('/custom')
      delete process.env.OVERLEAF_REGISTRATION_DISABLED_REDIRECT
      capture()
      const empty = await getSection('signup')
      expect(empty.disabledRedirectUrl).to.equal('')
    })

    it('provides the default private ranges for external URLs', async () => {
      setEnv()
      const section = await getSection('externalUrl')
      expect(section.blockedNetworks).to.include('127.0.0.0/8')
      expect(section.blockedNetworks).to.include('10.0.0.0/8')
      capture()
    })

    it('seeds misc from env + falls back to defaults', async () => {
      const MKEYS = [
        'APP_NAME', 'NAV_HIDE_POWERED_BY', 'ROBOTS_NOINDEX',
        'OVERLEAF_ALLOW_PUBLIC_ACCESS',
        'OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING',
        'OVERLEAF_DISABLE_LINK_SHARING', 'OVERLEAF_DISABLE_CHAT',
        'OVERLEAF_PROJECT_HARD_DELETION_DELAY', 'OVERLEAF_USER_HARD_DELETION_DELAY',
        'OVERLEAF_HISTORY_RESTORE', 'ENABLE_PDF_CACHING',
        'MAX_UPLOAD_SIZE', 'MAX_ENTITIES_PER_PROJECT', 'DEFAULT_LATEX_COMPILER',
      ]
      for (const k of MKEYS) delete process.env[k]

      // defaults with nothing in env
      const dflt = await getSection('misc')
      expect(dflt.navHidePoweredBy).to.equal(false)
      expect(dflt.enablePdfCaching).to.equal(true)
      expect(dflt.maxUploadSizeMiB).to.equal(50)
      expect(dflt.maxEntitiesPerProject).to.equal(2000)
      expect(dflt.defaultLatexCompiler).to.equal('pdflatex')
      // defaults are 90 days
      expect(dflt.projectHardDeletionDelayDays).to.equal(90)
      expect(dflt.userHardDeletionDelayDays).to.equal(90)

      // env wins
      process.env.APP_NAME = 'My Lab'
      process.env.NAV_HIDE_POWERED_BY = 'true'
      process.env.ROBOTS_NOINDEX = 'true'
      process.env.MAX_UPLOAD_SIZE = '200'
      process.env.MAX_ENTITIES_PER_PROJECT = '4000'
      process.env.DEFAULT_LATEX_COMPILER = 'lualatexmk'
      process.env.OVERLEAF_PROJECT_HARD_DELETION_DELAY = String(30 * 24 * 60 * 60 * 1000)
      const e = await getSection('misc')
      expect(e.appName).to.equal('My Lab')
      expect(e.navHidePoweredBy).to.equal(true)
      expect(e.robotsNoindex).to.equal(true)
      expect(e.maxUploadSizeMiB).to.equal(200)
      expect(e.maxEntitiesPerProject).to.equal(4000)
      expect(e.defaultLatexCompiler).to.equal('lualatexmk')
      expect(e.projectHardDeletionDelayDays).to.equal(30)

      for (const k of MKEYS) delete process.env[k]
    })
  })

  describe('SecretCipher', () => {
    it('round-trips text values (empty stays empty)', async () => {
      const enc = await encryptText('hello zotero')
      expect(enc).to.include('ss::')
      expect(enc).to.not.include('hello zotero')
      expect(await decryptText(enc)).to.equal('hello zotero')
      expect(await encryptText('')).to.equal('')
      expect(await decryptText('')).to.equal('')
    })
  })

  it('keeps the live database untouched (hermetic end: cleans only the unit collections)', async () => {
    assertUnitDb('hermetic end')
    // 2026-08-31: dropDatabase() can block server-side on connections held
    // by other test files in the SAME (shared, isolate:false) worker, and it
    // is the one call that could ever be destructive if MONGO_URL were ever
    // mis-set. Scoped deletes on the test's own collections are sufficient
    // for the hermetic start of the next run and can never touch live data.
    for (const name of ['site_settings', 'site_settings_snapshots']) {
      await unitDb.collection(name).deleteMany({}).catch(() => {})
    }
  })

  describe('R9 §7.2 stored-wins round-trip (2026-08-29)', () => {
    it('decrypts the stored github-sync secret and masks it', async () => {
      const m = globalThis.__ssm
      await m.setSection('github-sync', { enabled: true, clientID: 'ov-id', clientSecret: 'ov-secret-123' })
      const section = await m.getSection('github-sync', { githubSync: {} })
      expect(section.clientSecret).to.equal('ov-secret-123')
      const masked = m.maskSecrets('github-sync', section)
      expect(masked.clientSecret).to.equal('')
      expect(masked.clientSecretSet).to.equal(true)
    })

    it('empty secret on save keeps the previously stored one', async () => {
      const m = globalThis.__ssm
      await m.setSection('github-sync', { enabled: true, clientID: 'ov-id', clientSecret: 'ov-keep-456' })
      await m.setSection('github-sync', { enabled: true, clientID: 'ov-id', clientSecret: '' })
      const section = await m.getSection('github-sync', { githubSync: {} })
      expect(section.clientSecret).to.equal('ov-keep-456')
    })

    it('pandoc section stored-wins over the env seed', async () => {
      const m = globalThis.__ssm
      process.env.ENABLE_PANDOC_CONVERSIONS = 'false'
      process.env.PANDOC_IMAGE = 'env-image:1'
      try {
        await m.setSection('pandoc', { enabled: true, image: 'pandoc-ol:3.10.0.0' })
        const section = await m.getSection('pandoc', {})
        expect(section.enabled).to.equal(true)
        expect(section.image).to.equal('pandoc-ol:3.10.0.0')
      } finally {
        delete process.env.ENABLE_PANDOC_CONVERSIONS
        delete process.env.PANDOC_IMAGE
      }
      await m.setSection('pandoc', { enabled: false, image: '' })
      await m.setSection('github-sync', { enabled: false, clientID: '', clientSecret: '' })
    })
  })

  describe('R12-0 sibling-section retention + snapshots (P0 hardening)', () => {
    it('saving one section leaves sibling sections intact', async () => {
      const m = globalThis.__ssm
      await m.setSection('pandoc', { enabled: true, image: 'pandoc-ol:3.10.0.0' })
      await m.setSection('github-sync', { enabled: true, clientID: 'ov-id', clientSecret: 'ov-secret-789' })
      const pandoc = await m.getSection('pandoc', { pandoc: {} })
      const github = await m.getSection('github-sync', { githubSync: {} })
      expect(pandoc.image).to.equal('pandoc-ol:3.10.0.0')
      expect(github.clientSecret).to.equal('ov-secret-789')
      await m.setSection('pandoc', { enabled: false, image: '' })
      await m.setSection('github-sync', { enabled: false, clientID: '', clientSecret: '' })
    })

    it('writes a recoverable snapshot after each save', async () => {
      const m = globalThis.__ssm
      await m.setSection('pandoc', { enabled: true, image: 'pandoc-ol:snap-shot' })
      const doc = await unitDb.collection('site_settings').findOne({ _id: 'global' })
      expect(doc.pandoc.image).to.equal('pandoc-ol:snap-shot')
      const snaps = await unitDb.collection('site_settings_snapshots').find({}).toArray()
      expect(snaps.length).to.be.greaterThan(0)
      const latest = snaps[snaps.length - 1]
      expect(latest.doc.pandoc.image).to.equal('pandoc-ol:snap-shot')
      await m.setSection('pandoc', { enabled: false, image: '' })
    })
  })
})
