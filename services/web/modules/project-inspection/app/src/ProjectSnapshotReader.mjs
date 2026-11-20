import path from 'node:path'
import Settings from '@overleaf/settings'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import {
  AnalysisCancelledError,
  InvalidEntryPointError,
  ProjectTooLargeError,
} from './ProjectInspectionErrors.mjs'

const BIB_EXTENSION = /\.bib(?:tex)?$/i

const { maxSourceBytes, maxBibBytes, maxTotalBibBytes } = Settings.projectInspection

function normalizeProjectPath(projectPath) {
  return path.posix.normalize(projectPath.replace(/^\/+/, ''))
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new AnalysisCancelledError()
  }
}

async function streamToString(stream, maxBytes, signal) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    throwIfAborted(signal)
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      stream.destroy()
      return { content: null, truncated: true }
    }
    chunks.push(buffer)
  }
  return { content: Buffer.concat(chunks).toString('utf8'), truncated: false }
}

async function loadBinaryBibliography(projectId, file, signal) {
  if (!file.hash) {
    return { content: null, skippedReason: 'missing-hash' }
  }

  const { stream, contentLength, contentRange } =
    await HistoryManager.promises.requestBlobWithProjectId(
      projectId,
      file.hash,
      'GET',
      `bytes=0-${maxBibBytes - 1}`
    )

  const totalFromRange = Number.parseInt(contentRange?.split('/')?.[1] ?? '', 10)
  const knownSize = Number.isFinite(totalFromRange)
    ? totalFromRange
    : contentLength
  if (Number.isFinite(knownSize) && knownSize > maxBibBytes) {
    stream.destroy()
    return { content: null, skippedReason: 'file-too-large' }
  }

  const { content, truncated } = await streamToString(
    stream,
    maxBibBytes,
    signal
  )
  return {
    content,
    skippedReason: truncated ? 'file-too-large' : undefined,
  }
}

async function read(projectId, entryPointIds, { signal } = {}) {
  throwIfAborted(signal)
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  throwIfAborted(signal)

  const [docsByPath, filesByPath] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])

  const documents = Object.entries(docsByPath).map(([docPath, doc]) => ({
    id: doc._id.toString(),
    path: normalizeProjectPath(docPath),
    content: doc.lines.join('\n'),
    revision: doc.rev,
  }))
  const files = Object.entries(filesByPath).map(([filePath, file]) => ({
    id: file._id.toString(),
    path: normalizeProjectPath(filePath),
    hash: file.hash,
  }))

  if (documents.length + files.length > Settings.maxEntitiesPerProject) {
    throw new ProjectTooLargeError('inspection_error_too_many_entities', {
      limit: Settings.maxEntitiesPerProject,
    })
  }

  const documentsById = new Map(documents.map(doc => [doc.id, doc]))
  const entryPoints = entryPointIds.map(id => documentsById.get(id))
  if (entryPoints.some(entryPoint => entryPoint == null)) {
    throw new InvalidEntryPointError()
  }
  const validRootExtensions = new Set(
    Settings.validRootDocExtensions.map(value => `.${value.toLowerCase()}`)
  )
  if (
    entryPoints.some(
      entryPoint =>
        !validRootExtensions.has(path.posix.extname(entryPoint.path).toLowerCase())
    )
  ) {
    throw new InvalidEntryPointError('inspection_error_invalid_entry_point_file')
  }

  const totalSourceBytes = documents.reduce(
    (total, doc) => total + Buffer.byteLength(doc.content, 'utf8'),
    0
  )
  if (totalSourceBytes > maxSourceBytes) {
    throw new ProjectTooLargeError('inspection_error_source_too_large', {
      limit: Math.ceil(maxSourceBytes / (1024 * 1024)),
    })
  }

  const binaryBibliographies = []
  let totalBinaryBibliographyBytes = 0
  for (const file of files) {
    throwIfAborted(signal)
    if (!BIB_EXTENSION.test(file.path)) continue
    const bibliography = await loadBinaryBibliography(projectId, file, signal)
    totalBinaryBibliographyBytes += Buffer.byteLength(
      bibliography.content ?? '',
      'utf8'
    )
    if (totalBinaryBibliographyBytes > maxTotalBibBytes) {
      throw new ProjectTooLargeError('inspection_error_bibliography_too_large', {
        limit: Math.ceil(maxTotalBibBytes / (1024 * 1024)),
      })
    }
    binaryBibliographies.push({
      id: file.id,
      path: file.path,
      ...bibliography,
    })
  }

  return {
    projectId,
    documents,
    files,
    binaryBibliographies,
    entryPointIds,
  }
}

export default { read }
