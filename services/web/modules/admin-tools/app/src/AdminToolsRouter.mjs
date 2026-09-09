import logger from '@overleaf/logger'
import UserListController from './UserListController.mjs'
import ProjectListController from './ProjectListController.mjs'
import AdminToolsController from './AdminToolsController.mjs'
import SiteSettingsController from './SiteSettingsController.mjs'
import EmailTestController from './EmailTestController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import CollaboratorsController from '../../../../app/src/Features/Collaborators/CollaboratorsController.mjs'
import CollaboratorsInviteController from '../../../../app/src/Features/Collaborators/CollaboratorsInviteController.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import ProjectEditorHandler from '../../../../app/src/Features/Project/ProjectEditorHandler.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init AdminTools router')

    webRouter.get('/user/activate', UserListController.activateAccountPage)
    AuthenticationController.addEndpointToLoginWhitelist('/user/activate')

    webRouter.get('/admin/user',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.manageUsersPage
    )
    webRouter.post(
      '/admin/user/create',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.registerNewUser
    )
    webRouter.post('/admin/user/:userId/send-activation',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.sendActivationEmail
    )
    webRouter.get('/admin/user/:userId/info',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getAdditionalUserInfo,
    )
    webRouter.post('/admin/users',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getUsersJson
    )
    webRouter.post('/admin/user/:userId/delete',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.deleteUser
    )
    webRouter.post('/admin/user/:userId/update',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.updateUser,
    )
    webRouter.delete('/admin/user/:userId',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.purgeDeletedUser
    )
    webRouter.post('/admin/user/:userId/restore',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.restoreDeletedUser
    )
    webRouter.post('/admin/user/:userId/projects',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.getProjectsJson
    )

    webRouter.get('/admin/project',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.manageProjectsPage
    )
    webRouter.post('/admin/project/:project_id/trash',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.trashProjectForUser
    )
    webRouter.post('/admin/project/:project_id/untrash',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.untrashProjectForUser
    )
    webRouter.delete('/admin/project/:project_id/purge',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.purgeDeletedProject
    )
    webRouter.delete('/admin/project/:project_id',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.deleteProject
    )
    webRouter.post('/admin/project/:project_id/undelete',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.undeleteProject
    )

    // 2026-08-31 (user request A): view + manage the share/invitation list
    // of ANY project (members, roles, pending invites, sharing link). The
    // core /project/* routes carry member-only middleware; these admin
    // routes mount the SAME core controller handlers (their membership
    // checks live in the /project/* router middleware, not in the handlers)
    // under /admin/project, guarded only by ensureUserIsSiteAdmin — an
    // admin acting on any project is the point. NOTE param names: the core
    // handlers parse `Project_id` (capital P), so the route params must
    // keep that exact name.
    //
    // N-F fix (2026-08-31): the upstream getAllMembers intentionally EXCLUDES
    // the project owner (loadInvitedMembers filters privilegeLevel OWNER),
    // which made the admin share view look empty for owner-only projects.
    // This wrapper returns { owner, members } instead, using the same core
    // getters/view-builder — no upstream file touched.
    webRouter.get('/admin/project/:Project_id/members',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      async (req, res, next) => {
        try {
          const projectId = req.params.Project_id
          const projectAccess =
            await CollaboratorsGetter.promises.getProjectAccess(projectId)
          const [ownerMember, members] = await Promise.all([
            projectAccess.loadOwner(),
            CollaboratorsGetter.promises.getAllInvitedMembers(projectId),
          ])
          res.json({
            owner: ownerMember
              ? ProjectEditorHandler.buildUserModelView(ownerMember)
              : null,
            members,
          })
        } catch (err) {
          next(err)
        }
      }
    )
    webRouter.get('/admin/project/:Project_id/invites',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsInviteController.getAllInvites
    )
    webRouter.post('/admin/project/:Project_id/invite',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsInviteController.inviteToProject
    )
    webRouter.put('/admin/project/:Project_id/users/:user_id',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsController.setCollaboratorInfo
    )
    webRouter.delete('/admin/project/:Project_id/users/:user_id',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsController.removeUserFromProject
    )
    webRouter.delete('/admin/project/:Project_id/invite/:invite_id',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsInviteController.revokeInvite
    )
    webRouter.post('/admin/project/:Project_id/invite/:invite_id/resend',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsInviteController.generateNewInvite
    )
    webRouter.get('/admin/project/:Project_id/sharing-link',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsInviteController.getSharingLink
    )
    webRouter.post('/admin/project/:Project_id/sharing-link',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      CollaboratorsInviteController.updateSharingLink
    )

    webRouter.get('/admin/active-projects',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      AdminToolsController.activeProjects,
    )

    // ---- Manage Site (SiteSettings: templates/zotero/external-urls/signup) ---
    webRouter.get('/admin/site',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      SiteSettingsController.manageSitePage
    )
    webRouter.get('/admin/site-settings',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      SiteSettingsController.getSiteSettings
    )
    webRouter.put('/admin/site-settings/:section',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      SiteSettingsController.updateSiteSettings
    )
    // UI round 10 item 6: send a one-off test e-mail through the stored
    // E-mail section (admin-only, rate-limited, sanitized errors).
    webRouter.post('/admin/site-settings/email/test',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      EmailTestController.sendTestEmail
    )
    // R6 item 7 (2026-08-29): list the users holding the template gallery
    // admin flag (Manage Site → Templates table).
    webRouter.get('/admin/site/template-admins',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.templateAdmins
    )
  },
}
