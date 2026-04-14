import { vi } from 'vitest'
import sinon from 'sinon'

const modulePath = new URL(
  '../../../../app/src/Features/Notifications/NotificationsController.mjs',
  import.meta.url
).pathname

describe('NotificationsController', function () {
  const userId = '123nd3ijdks'
  const notificationId = '123njdskj9jlk'

  beforeEach(async function (ctx) {
    ctx.handler = {
      getUserNotifications: sinon.stub().callsArgWith(1),
      markAsRead: sinon.stub().callsArgWith(2),
      promises: {
        getUserNotifications: sinon.stub().callsArgWith(1),
      },
    }
    ctx.preferencesHandler = {
      promises: {
        getProjectPreferences: sinon.stub().resolves({}),
        saveProjectPreferences: sinon.stub().resolves({}),
      },
    }
    ctx.req = {
      params: {
        notificationId,
        projectId: 'project-id-123',
      },
      session: {
        user: {
          _id: userId,
        },
      },
      i18n: {
        translate() {},
      },
    }
    ctx.AuthenticationController = {
      getLoggedInUserId: sinon.stub().returns(ctx.req.session.user._id),
    }

    vi.doMock(
      '../../../../app/src/Features/Notifications/NotificationsHandler',
      () => ({
        default: ctx.handler,
      })
    )

    vi.doMock(
      '../../../../app/src/Features/Notifications/NotificationsPreferencesHandler',
      () => ({
        default: ctx.preferencesHandler,
      })
    )

    vi.doMock(
      '../../../../app/src/Features/Authentication/AuthenticationController',
      () => ({
        default: ctx.AuthenticationController,
      })
    )

    ctx.controller = (await import(modulePath)).default
  })

  it('should ask the handler for all unread notifications', async function (ctx) {
    await new Promise(resolve => {
      const allNotifications = [{ _id: notificationId, user_id: userId }]
      ctx.handler.getUserNotifications = sinon
        .stub()
        .callsArgWith(1, null, allNotifications)
      ctx.controller.getAllUnreadNotifications(ctx.req, {
        json: body => {
          body.should.deep.equal(allNotifications)
          ctx.handler.getUserNotifications.calledWith(userId).should.equal(true)
          resolve()
        },
      })
    })
  })

  it('should send a delete request when a delete has been received to mark a notification', async function (ctx) {
    await new Promise(resolve => {
      ctx.controller.markNotificationAsRead(ctx.req, {
        sendStatus: () => {
          ctx.handler.markAsRead
            .calledWith(userId, notificationId)
            .should.equal(true)
          resolve()
        },
      })
    })
  })

  it('should get a notification by notification id', async function (ctx) {
    await new Promise(resolve => {
      const notification = { _id: notificationId, user_id: userId }
      ctx.handler.getUserNotifications = sinon
        .stub()
        .callsArgWith(1, null, [notification])
      ctx.controller.getNotification(ctx.req, {
        json: body => {
          body.should.deep.equal(notification)
          resolve()
        },
        status: () => ({
          end: () => {},
        }),
      })
    })
  })

  it('should return project preferences for a project', async function (ctx) {
    const expectedPreferences = {
      trackedChangesOnOwnProject: true,
      trackedChangesOnInvitedProject: true,
      commentOnOwnProject: true,
      commentOnInvitedProject: true,
      repliesOnOwnProject: true,
      repliesOnInvitedProject: true,
      repliesOnAuthoredThread: true,
      repliesOnParticipatingThread: true,
      sendCommentReplyEmails: false,
    }
    ctx.preferencesHandler.promises.getProjectPreferences.resolves(
      expectedPreferences
    )

    await ctx.controller.getProjectPreferences(ctx.req, {
      json: body => {
        body.should.deep.equal(expectedPreferences)
      },
    })

    ctx.preferencesHandler.promises.getProjectPreferences.calledWith(
      userId,
      ctx.req.params.projectId
    ).should.equal(true)
  })

  it('should save project preferences for a project', async function (ctx) {
    const expectedPreferences = {
      trackedChangesOnOwnProject: false,
      trackedChangesOnInvitedProject: false,
      commentOnOwnProject: false,
      commentOnInvitedProject: false,
      repliesOnOwnProject: false,
      repliesOnInvitedProject: false,
      repliesOnAuthoredThread: true,
      repliesOnParticipatingThread: true,
      sendCommentReplyEmails: false,
    }
    ctx.req.body = expectedPreferences
    ctx.preferencesHandler.promises.saveProjectPreferences.resolves(
      expectedPreferences
    )

    await ctx.controller.saveProjectPreferences(ctx.req, {
      json: body => {
        body.should.deep.equal(expectedPreferences)
      },
    })

    ctx.preferencesHandler.promises.saveProjectPreferences.calledWith(
      userId,
      ctx.req.params.projectId,
      expectedPreferences
    ).should.equal(true)
  })
})
