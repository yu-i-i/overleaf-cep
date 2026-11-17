import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import { Readable } from 'node:stream'

const base = '../../../../app/src/Features/'
describe('ProjectOutputFileAgent', () => {
  beforeEach(async ctx => {
    ctx.data = {
      provider: 'project_output_file',
      source_project_id: 'source',
      source_output_file_path: 'output.pdf',
      build_id: 'old-build',
      clsiServerId: 'old-server',
    }
    ctx.stream = Readable.from(['PDF'])
    ctx.auth = { canUserReadProject: sinon.stub().callsArgWith(3, null, true) }
    ctx.compile = {
      compile: sinon
        .stub()
        .callsArgWith(
          3,
          null,
          'success',
          [{ path: 'output.pdf', build: 'new-build' }],
          'new-server'
        ),
    }
    ctx.clsi = {
      getOutputFileStream: sinon.stub().callsArgWith(5, null, ctx.stream),
    }
    ctx.handler = {
      getSourceProject: sinon.stub().callsArgWith(1, null, { _id: 'source' }),
      importFromStream: sinon.stub().callsArgWith(6, null, { _id: 'linked' }),
    }
    ctx.projectFile = { _canCreate: sinon.stub().returns(true) }
    vi.doMock(base + 'Authorization/AuthorizationManager.mjs', () => ({
      default: ctx.auth,
    }))
    vi.doMock(base + 'Compile/CompileManager.mjs', () => ({
      default: ctx.compile,
    }))
    vi.doMock(base + 'Compile/ClsiManager.mjs', () => ({ default: ctx.clsi }))
    vi.doMock(base + 'LinkedFiles/LinkedFilesHandler.mjs', () => ({
      default: ctx.handler,
    }))
    vi.doMock(base + 'LinkedFiles/ProjectFileAgent.mjs', () => ({
      default: ctx.projectFile,
    }))
    ctx.agent = (
      await import(base + 'LinkedFiles/ProjectOutputFileAgent.mjs')
    ).default
    ctx.refresh = () =>
      ctx.agent.promises.refreshLinkedFile(
        'target',
        ctx.data,
        'linked.pdf',
        'folder',
        'user',
        {}
      )
    ctx.create = () =>
      ctx.agent.promises.createLinkedFile(
        'target',
        ctx.data,
        'linked.pdf',
        'folder',
        'user',
        {}
      )
  })
  it('imports the selected existing build and strips extra metadata', async ctx => {
    ctx.data.untrusted = 'ignored'
    expect(await ctx.create()).toBe('linked')
    expect(ctx.clsi.getOutputFileStream.firstCall.args.slice(0, 5)).toEqual([
      'source',
      'user',
      'old-server',
      'old-build',
      'output.pdf',
    ])
    expect(
      ctx.handler.importFromStream.firstCall.args[2].untrusted
    ).toBeUndefined()
    expect(ctx.compile.compile.called).toBe(false)
  })
  for (const server of ['new-server', undefined]) {
    it(`saves the matching refreshed build and server (${server})`, async ctx => {
      ctx.compile.compile.callsArgWith(
        3,
        null,
        'success',
        [{ path: 'output.pdf', build: 'new-build' }],
        server
      )
      expect(await ctx.refresh()).toBe('linked')
      expect(ctx.clsi.getOutputFileStream.firstCall.args.slice(0, 5)).toEqual([
        'source',
        'user',
        server,
        'new-build',
        'output.pdf',
      ])
      expect(ctx.handler.importFromStream.firstCall.args[2]).toMatchObject({
        build_id: 'new-build',
        clsiServerId: server,
      })
    })
  }
  it('rechecks source access before every refresh', async ctx => {
    await ctx.create()
    ctx.handler.importFromStream.resetHistory()
    ctx.clsi.getOutputFileStream.resetHistory()
    ctx.auth.canUserReadProject.callsArgWith(3, null, false)
    await expect(ctx.refresh()).to.be.rejected
    expect(ctx.compile.compile.called).toBe(false)
    expect(ctx.clsi.getOutputFileStream.called).toBe(false)
    expect(ctx.handler.importFromStream.called).toBe(false)
  })
  for (const failure of ['compile', 'missing output', 'fetch']) {
    it(`keeps the destination untouched on ${failure} failure`, async ctx => {
      if (failure === 'compile')
        ctx.compile.compile.callsArgWith(3, null, 'failure', [])
      if (failure === 'missing output')
        ctx.compile.compile.callsArgWith(3, null, 'success', [])
      if (failure === 'fetch')
        ctx.clsi.getOutputFileStream.callsArgWith(5, new Error('fetch failed'))
      await expect(ctx.refresh()).to.be.rejected
      expect(ctx.handler.importFromStream.called).toBe(false)
      expect(ctx.data.build_id).toBe('old-build')
      expect(ctx.data.clsiServerId).toBe('old-server')
    })
  }
  it('rejects incomplete metadata before accessing the source', async ctx => {
    delete ctx.data.build_id
    await expect(ctx.create()).to.be.rejected
    expect(ctx.handler.getSourceProject.called).toBe(false)
  })
  it('rejects legacy creation before importing', async ctx => {
    ctx.projectFile._canCreate.returns(false)
    await expect(ctx.create()).to.be.rejected
    expect(ctx.handler.importFromStream.called).toBe(false)
  })
})
