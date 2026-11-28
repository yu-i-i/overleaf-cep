import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import Path from 'node:path'
import { promisify } from 'node:util'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

const execFile = promisify(execFileCallback)
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

async function isPng(fileName, filePath) {
  if (Path.extname(fileName).toLowerCase() !== '.png') {
    return false
  }
  const file = await fs.open(filePath, 'r')
  try {
    const signature = Buffer.alloc(PNG_SIGNATURE.length)
    const { bytesRead } = await file.read(signature, 0, signature.length, 0)
    return bytesRead === signature.length && signature.equals(PNG_SIGNATURE)
  } finally {
    await file.close()
  }
}

async function optimizeIfBeneficial({ fileName, filePath }) {
  if (!Settings.pngOptimization?.enabled) {
    return
  }

  let candidatePath
  try {
    if (!(await isPng(fileName, filePath))) {
      return
    }

    const originalSize = (await fs.stat(filePath)).size
    candidatePath = Path.join(
      Path.dirname(filePath),
      `${Path.basename(filePath)}-${randomUUID()}.png`
    )
    await execFile(
      'oxipng',
      [
        '--quiet',
        '--threads',
        String(Settings.pngOptimization.threads),
        '-o',
        Settings.pngOptimization.level,
        '--out',
        candidatePath,
        '--',
        filePath,
      ],
      {
        timeout: Settings.pngOptimization.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
      }
    )

    const candidateStat = await fs.stat(candidatePath)
    if (!candidateStat.isFile() || candidateStat.size >= originalSize) {
      return
    }

    await fs.rename(candidatePath, filePath)
    candidatePath = undefined
    logger.info(
      {
        fileName,
        originalSize,
        optimizedSize: candidateStat.size,
        savedBytes: originalSize - candidateStat.size,
      },
      'optimized uploaded PNG'
    )
  } catch (err) {
    logger.warn({ err, fileName }, 'PNG optimization failed; using original')
  } finally {
    if (candidatePath) {
      await fs.rm(candidatePath, { force: true }).catch(err => {
        logger.warn(
          { err, fileName },
          'failed to remove optimized PNG candidate'
        )
      })
    }
  }
}

export default { optimizeIfBeneficial }
