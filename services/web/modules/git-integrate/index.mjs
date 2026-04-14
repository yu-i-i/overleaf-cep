/**
 * git-integrate module for Overleaf
 *
 * Enables push/pull synchronisation between Overleaf projects and external Git
 * hosting services (GitHub, GitLab, Gitea, Forgejo).
 *
 * Architecture inspired by TeXlyre's backup extras
 * (texlyre/extras/backup/{github,gitlab,gitea,forgejo}), adapted for the
 * Overleaf server-side module system and its Node.js/MongoDB infrastructure.
 * See: https://github.com/TeXlyre/texlyre (MIT Licence)
 *
 * Unlike services/web/modules/git-bridge (which exposes Overleaf as a git
 * *server* over the internal git-bridge daemon), this module connects to
 * *external* Git hosting services directly via their respective REST APIs.
 *
 * Activated unless GIT_INTEGRATE_ENABLED is explicitly set to 'false'.
 */

import logger from '@overleaf/logger'
import GitIntegrateRouter from './app/src/GitIntegrateRouter.mjs'

let GitIntegrateModule = {}

if (process.env.GIT_INTEGRATE_ENABLED !== 'false') {
    logger.debug({}, 'Enabling git-integrate module')
    GitIntegrateModule = {
        router: GitIntegrateRouter,
    }
}

export default GitIntegrateModule
