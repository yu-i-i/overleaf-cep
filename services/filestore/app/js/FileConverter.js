import metrics from '@overleaf/metrics'
import Settings from '@overleaf/settings'
import { callbackify } from 'node:util'
import SafeExec from './SafeExec.js'
import SandboxConverterRunner from './SandboxConverterRunner.js'
import Errors from './Errors.js'

const { ConversionError } = Errors

const APPROVED_FORMATS = ['png', 'jpg']
const FOURTY_SECONDS = 40 * 1000
const KILL_SIGNAL = 'SIGTERM'

export default {
  convert: callbackify(convert),
  thumbnail: callbackify(thumbnail),
  preview: callbackify(preview),
  promises: {
    convert,
    thumbnail,
    preview,
  },
}

async function convert(sourcePath, requestedFormat) {
  if (Settings.converter === 'pdftocairo-sandbox') {
    return await _convertInSandbox(sourcePath, requestedFormat, 1500)
  }
  if (Settings.converter === 'pdftocairo') {
    const width = 1500
    return await _convert(sourcePath, requestedFormat, [
      'pdftocairo',
      '-png',
      '-singlefile',
      '-scale-to-x',
      width.toString(),
      '-scale-to-y',
      '-1', // maintain aspect ratio
      sourcePath,
    ])
  } else {
    const width = '600x'
    return await _convert(sourcePath, requestedFormat, [
      'convert',
      '-define',
      `pdf:fit-page=${width}`,
      '-flatten',
      '-density',
      '300',
      `${sourcePath}[0]`,
    ])
  }
}

async function thumbnail(sourcePath) {
  if (Settings.converter === 'pdftocairo-sandbox') {
    return await _convertInSandbox(sourcePath, 'png', 700)
  }
  if (Settings.converter === 'pdftocairo') {
    const width = 700
    return await _convert(sourcePath, 'png', [
      'pdftocairo',
      '-png',
      '-singlefile',
      '-scale-to-x',
      width.toString(),
      '-scale-to-y',
      '-1', // maintain aspect ratio
      sourcePath,
    ])
  } else {
    const width = '260x'
    return await convert(sourcePath, 'png', [
      'convert',
      '-flatten',
      '-background',
      'white',
      '-density',
      '300',
      '-define',
      `pdf:fit-page=${width}`,
      `${sourcePath}[0]`,
      '-resize',
      width,
    ])
  }
}

async function preview(sourcePath) {
  const width = 1000
  if (Settings.converter === 'pdftocairo-sandbox') {
    return await _convertInSandbox(sourcePath, 'png', width)
  }
  if (Settings.converter === 'pdftocairo') {
    return await _convert(sourcePath, 'png', [
      'pdftocairo',
      '-png',
      '-singlefile',
      '-scale-to-x',
      width.toString(),
      '-scale-to-y',
      '-1', // maintain aspect ratio
      sourcePath,
    ])
  } else {
    return await convert(sourcePath, 'png', [
      'convert',
      '-flatten',
      '-background',
      'white',
      '-density',
      '300',
      '-define',
      `pdf:fit-page=${width}`,
      `${sourcePath}[0]`,
      '-resize',
      width,
    ])
  }
}

/**
 * Run the pdftocairo conversion inside a sandboxed sibling container (no
 * network, all caps dropped, memory cap — see SandboxConverterRunner.js).
 *
 * Keeps the same contract as the local path: the result is written to
 * `${sourcePath}.${requestedFormat}`.
 *
 * @param {string} sourcePath
 * @param {string} requestedFormat 'png' or 'jpg'
 * @param {number} width output width in px
 * @return {Promise<{outputHostPath: string}>}
 */
async function _convertInSandbox(sourcePath, requestedFormat, width) {
  if (!APPROVED_FORMATS.includes(requestedFormat)) {
    throw new ConversionError('invalid format requested', { format: requestedFormat })
  }
  const ext = requestedFormat
  const workDir = '/work'
  // poppler appends the device extension to the output argument, so the
  // argument must end WITHOUT an extension; the result lands at
  // /work/input.pdf.<png|jpg> next to the input.
  const device = requestedFormat === 'png' ? '-png' : '-jpeg'
  const result = await SandboxConverterRunner.runConversion({
    sourcePath,
    containerArgs: [
      'pdftocairo',
      device,
      '-singlefile',
      '-scale-to-x',
      width.toString(),
      '-scale-to-y',
      '-1', // maintain aspect ratio
      `${workDir}/input.pdf`,
      `${workDir}/input.pdf`,
    ],
    workDir,
    outputBase: 'input.pdf',
    outputExt: ext,
    destPath: `${sourcePath}.${requestedFormat}`,
  })
  // Same contract as the local converters: return the destination path string.
  return result.outputHostPath
}

async function _convert(sourcePath, requestedFormat, command) {
  if (!APPROVED_FORMATS.includes(requestedFormat)) {
    throw new ConversionError('invalid format requested', {
      format: requestedFormat,
    })
  }

  const timer = new metrics.Timer('imageConvert')
  const destPath = `${sourcePath}.${requestedFormat}`

  command.push(Settings.converter === 'pdftocairo' ? sourcePath : destPath)
  command = Settings.commands.convertCommandPrefix.concat(command)

  try {
    await SafeExec.promises(command, {
      killSignal: KILL_SIGNAL,
      timeout: FOURTY_SECONDS,
    })
  } catch (err) {
    throw new ConversionError(
      'something went wrong converting file',
      { stderr: err.stderr, sourcePath, requestedFormat, destPath },
      err
    )
  }

  timer.done()
  return destPath
}
