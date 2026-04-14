/**
 * Express router for git-integrate.
 *
 * All per-project routes require the user to be logged in AND have write
 * access to the project (using the same middleware as other write operations).
 *
 * The two setup-only routes (/repos and /branches) only require login because
 * they list repositories available to a token that the user has not yet
 * associated with a project.
 */

import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import * as GitIntegrateController from './GitIntegrateController.mjs'

export default {
    apply(webRouter /*, privateApiRouter, publicApiRouter */) {
        logger.debug({}, 'Init git-integrate router')

        // ── Setup wizard: list repos / branches / create for an unvalidated token ────
        webRouter.post(
            '/git-integrate/repos/create',
            AuthenticationController.requireLogin(),
            GitIntegrateController.createRepository
        )
        webRouter.post(
            '/git-integrate/repos',
            AuthenticationController.requireLogin(),
            GitIntegrateController.listRepositories
        )
        webRouter.post(
            '/git-integrate/branches',
            AuthenticationController.requireLogin(),
            GitIntegrateController.listBranches
        )

        // ── Per-project connection management ───────────────────────────────────
        webRouter.get(
            '/git-integrate/project/:project_id',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            GitIntegrateController.getConnection
        )
        webRouter.post(
            '/git-integrate/project/:project_id/connect',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            GitIntegrateController.connect
        )
        webRouter.delete(
            '/git-integrate/project/:project_id',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            GitIntegrateController.disconnect
        )

        // ── Push ────────────────────────────────────────────────────────────────
        webRouter.post(
            '/git-integrate/project/:project_id/push',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            GitIntegrateController.push
        )

        // ── Pull ────────────────────────────────────────────────────────────────
        webRouter.post(
            '/git-integrate/project/:project_id/pull',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            GitIntegrateController.pull
        )
    }
}
