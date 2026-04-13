import { vi } from 'vitest'
import sinon from 'sinon'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import MockRequest from '../helpers/MockRequest.mjs'
import MockResponse from '../helpers/MockResponse.mjs'

const modulePath = '../../../../modules/pandoc-docx/app/src/PandocDocxController.mjs'

describe('PandocDocxController', function () {
    beforeEach(async function (ctx) {
        ctx.req = new MockRequest(vi)
        ctx.res = new MockResponse(vi)
        ctx.next = sinon.stub()

        ctx.PandocDocxService = {
            convertProjectToDocx: sinon.stub(),
        }

        vi.doMock('@overleaf/metrics', () => ({ default: { inc: sinon.stub() } }))
        vi.doMock('../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
            default: { promises: { getProject: sinon.stub() } },
        }))
        vi.doMock('../../../../modules/pandoc-docx/app/src/PandocDocxService.mjs', () => ({
            default: ctx.PandocDocxService,
        }))

        ctx.controller = (await import(modulePath)).default
    })

    afterEach(function () {
        vi.resetAllMocks()
    })

    it('streams generated docx with correct headers', async function (ctx) {
        const parentDir = path.join(os.tmpdir(), 'pandoc-docx-test')
        await fs.promises.mkdir(parentDir, { recursive: true })
        const outputPath = path.join(parentDir, 'project.docx')
        await fs.promises.writeFile(outputPath, 'dummy')

        ctx.req.params = { Project_id: 'project123' }
        ctx.PandocDocxService.convertProjectToDocx.resolves({
            outputPath,
            workdir: parentDir,
        })
        ctx.ProjectGetter = (await import('../../../../app/src/Features/Project/ProjectGetter.mjs')).default
        ctx.ProjectGetter.promises.getProject.resolves({ name: 'test project' })

        const fakeStream = {
            on: sinon.stub(),
            pipe: sinon.stub(),
        }
        const createReadStreamSpy = vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream)

        await ctx.controller.downloadDocx(ctx.req, ctx.res, ctx.next)

        sinon.assert.calledWith(createReadStreamSpy, outputPath)
        sinon.assert.calledWith(fakeStream.pipe, ctx.res)
        expect(ctx.res.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        expect(ctx.res.headers['Content-Disposition']).toContain('test_project.docx')

        createReadStreamSpy.mockRestore()
    })
})
