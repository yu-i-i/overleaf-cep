import { vi, expect } from 'vitest'
import sinon from 'sinon'

const modulePath =
  '../../../../modules/authentication/oidc/app/src/OIDCAuthenticationManager.mjs'

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function makeJwt(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${header}.${body}.`
}

describe('OIDCAuthenticationManager', function () {
  beforeEach(async function (ctx) {
    ctx.profile = {
      emails: [{ value: 'example@overleaf.com' }],
      id: 'oidc-user-123',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
    }
    ctx.auditLog = { ipAddress: '0:0:0:0', info: {} }

    vi.doMock('@overleaf/settings', () => ({
      default: {
        oidc: {
          providerId: 'oidc',
          attUserId: 'id',
          guestUserRole: 'guest-role',
          updateUserDetailsOnLogin: false,
        },
      },
    }))

    vi.doMock('../../../../app/src/Features/User/ThirdPartyIdentityManager.mjs', () => ({
      default: (ctx.ThirdPartyIdentityManager = {
        promises: {
          login: sinon.stub().resolves({ _id: 'user1', loginEpoch: 0 }),
          link: sinon.stub().resolves(),
        },
      }),
    }))

    vi.doMock('../../../../app/src/models/User.mjs', () => ({
      User: (ctx.User = {
        updateOne: sinon.stub().returns({ exec: sinon.stub().resolves({ modifiedCount: 1 }) }),
        findOne: sinon.stub().returns({ exec: sinon.stub().resolves(undefined) }),
      }),
    }))

    vi.doMock('../../../../app/src/Features/User/UserCreator.mjs', () => ({
      default: (ctx.UserCreator = { promises: { createNewUser: sinon.stub() } }),
    }))

    vi.doMock('../../../../app/src/Features/Authentication/AuthenticationErrors.mjs', () => ({
      ParallelLoginError: class ParallelLoginError extends Error {},
    }))

    ctx.OIDCAuthenticationManager = (await import(modulePath)).default
  })

  it('maps token role presence to guest-user and does not persist oidcUserData on login', async function (ctx) {
    const idToken = makeJwt({ sub: 'sub1', roles: ['grpA', 'grpB'] })

    await ctx.OIDCAuthenticationManager.promises.findOrCreateUser(ctx.profile, ctx.auditLog, {
      idToken,
    })

    const call = ctx.ThirdPartyIdentityManager.promises.login.getCall(0)
    expect(call.args[0]).to.equal('oidc') // providerId
    expect(call.args[1]).to.equal('oidc-user-123') // external user id
    expect(call.args[2]).to.equal(null)
  })

  it('adds guest-user when configured role is present', async function (ctx) {
    const idToken = makeJwt({ sub: 'sub1', roles: ['guest-role'] })

    await ctx.OIDCAuthenticationManager.promises.findOrCreateUser(ctx.profile, ctx.auditLog, {
      idToken,
    })

    expect(ctx.User.updateOne).to.have.been.calledWith(
      { _id: 'user1' },
      { $addToSet: { adminRoles: 'guest-user' } }
    )
  })

  it('removes guest-user when configured role is absent', async function (ctx) {
    const idToken = makeJwt({ sub: 'sub1', roles: ['other-role'] })

    await ctx.OIDCAuthenticationManager.promises.findOrCreateUser(ctx.profile, ctx.auditLog, {
      idToken,
    })

    expect(ctx.User.updateOne).to.have.been.calledWith(
      { _id: 'user1' },
      { $pull: { adminRoles: 'guest-user' } }
    )
  })

  it('also maps guest-user on link flow', async function (ctx) {
    const idToken = makeJwt({ sub: 'sub1', roles: ['guest-role'] })

    await ctx.OIDCAuthenticationManager.promises.linkAccount('user1', ctx.profile, ctx.auditLog, {
      idToken,
    })

    const call = ctx.ThirdPartyIdentityManager.promises.link.getCall(0)
    expect(call.args[0]).to.equal('user1')
    expect(call.args[1]).to.equal('oidc')
    expect(call.args[2]).to.equal('oidc-user-123')
    expect(call.args[3]).to.equal(null)
    expect(ctx.User.updateOne).to.have.been.calledWith(
      { _id: 'user1' },
      { $addToSet: { adminRoles: 'guest-user' } }
    )
  })

  it('stores no oidcUserData when roles are absent', async function (ctx) {
    const idToken = makeJwt({ sub: 'sub1' })

    await ctx.OIDCAuthenticationManager.promises.findOrCreateUser(ctx.profile, ctx.auditLog, {
      idToken,
    })

    const call = ctx.ThirdPartyIdentityManager.promises.login.getCall(0)
    expect(call.args[2]).to.equal(null)
  })
})

