import PageShellsRouter from './app/src/PageShellsRouter.mjs'

/**
 * @import { WebModule } from "../../types/web-module"
 */

/**
 * PSH — Page shells (UI-R10 W8, 2026-08-30).
 *
 * CE+ fork wrappers that give the UPSTREAM pages bookmarkable, themed
 * same-origin addresses:
 *
 *   GET /admin/panel     -> the upstream /admin tabset (AdminController.index
 *                           locals, rendered inside this module's own view)
 *   GET /user/mysettings -> the upstream account-settings React app
 *                           (UserPagesController.settingsPage locals,
 *                           rendered by this module's own view)
 *
 * HARD CONSTRAINT (fork policy): NO upstream file is edited by this feature.
 * Upstream files are IMPORTED (handlers, mixins, partials, React
 * entrypoints) and verified byte-identical by the unit tests.
 */

/** @type {WebModule} */
const PageShellsModule = {
  router: PageShellsRouter,
}

export default PageShellsModule
