import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'

const MODULE_PATH = '../../../../app/src/Features/Uploads/PngOptimizer.mjs'
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

describe('PngOptimizer', function () {
  beforeEach(async function (ctx) {
    vi.resetModules()
    ctx.dir = await fs.mkdtemp(Path.join(os.tmpdir(), 'png-optimizer-test-'))
    ctx.filePath = Path.join(ctx.dir, 'upload')
    ctx.original = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(100)])
    await fs.writeFile(ctx.filePath, ctx.original)
    ctx.settings = {
      pngOptimization: {
        enabled: true,
        level: '2',
        timeoutMs: 30_000,
        threads: 3,
      },
    }
    ctx.execFile = sinon.stub().callsFake((command, args, options, callback) => {
      const outputPath = args[args.indexOf('--out') + 1]
      fs.writeFile(outputPath, Buffer.concat([PNG_SIGNATURE, Buffer.alloc(10)]))
        .then(() => callback(null, '', ''))
        .catch(callback)
    })
    vi.doMock('node:child_process', () => ({ execFile: ctx.execFile }))
    vi.doMock('@overleaf/settings', () => ({ default: ctx.settings }))
    ctx.PngOptimizer = (await import(MODULE_PATH)).default
  })

  afterEach(async function (ctx) {
    await fs.rm(ctx.dir, { recursive: true, force: true })
  })

  it('replaces a PNG when oxipng produces a smaller file', async function (ctx) {
    await ctx.PngOptimizer.optimizeIfBeneficial({
      fileName: 'figure.PNG',
      filePath: ctx.filePath,
    })

    expect((await fs.stat(ctx.filePath)).size).to.equal(18)
    expect(ctx.execFile.calledOnce).to.equal(true)
    expect(ctx.execFile.firstCall.args[0]).to.equal('oxipng')
    expect(ctx.execFile.firstCall.args[1]).to.include.members([
      '--threads',
      '3',
      '-o',
      '2',
    ])
    expect(ctx.execFile.firstCall.args[2]).to.deep.include({
      timeout: 30_000,
      killSignal: 'SIGKILL',
    })
  })

  it('keeps the original when the optimized file is not smaller', async function (ctx) {
    ctx.execFile.callsFake((command, args, options, callback) => {
      const outputPath = args[args.indexOf('--out') + 1]
      fs.writeFile(outputPath, Buffer.concat([ctx.original, Buffer.alloc(1)]))
        .then(() => callback(null, '', ''))
        .catch(callback)
    })

    await ctx.PngOptimizer.optimizeIfBeneficial({
      fileName: 'figure.png',
      filePath: ctx.filePath,
    })

    expect(await fs.readFile(ctx.filePath)).to.deep.equal(ctx.original)
  })

  it('keeps the original when oxipng fails', async function (ctx) {
    ctx.execFile.callsFake((command, args, options, callback) => {
      callback(new Error('oxipng failed'))
    })

    await ctx.PngOptimizer.optimizeIfBeneficial({
      fileName: 'figure.png',
      filePath: ctx.filePath,
    })

    expect(await fs.readFile(ctx.filePath)).to.deep.equal(ctx.original)
  })

  it('does not process non-PNG extensions', async function (ctx) {
    await ctx.PngOptimizer.optimizeIfBeneficial({
      fileName: 'figure.jpg',
      filePath: ctx.filePath,
    })

    expect(ctx.execFile.called).to.equal(false)
  })

  it('does not process files with an invalid PNG signature', async function (ctx) {
    await fs.writeFile(ctx.filePath, 'not a png')

    await ctx.PngOptimizer.optimizeIfBeneficial({
      fileName: 'figure.png',
      filePath: ctx.filePath,
    })

    expect(ctx.execFile.called).to.equal(false)
  })

  it('does nothing when optimization is disabled', async function (ctx) {
    ctx.settings.pngOptimization.enabled = false

    await ctx.PngOptimizer.optimizeIfBeneficial({
      fileName: 'figure.png',
      filePath: ctx.filePath,
    })

    expect(ctx.execFile.called).to.equal(false)
  })
})
