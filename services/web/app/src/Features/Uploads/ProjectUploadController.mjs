import logger from '@overleaf/logger'
import metrics from '@overleaf/metrics'
import fs from 'node:fs'
import os from 'node:os'
import Path from 'node:path'
import uuid from 'uuid'
const { v4: uuidv4 } = uuid
import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import FileSystemImportManager from './FileSystemImportManager.mjs'
import ProjectUploadManager from './ProjectUploadManager.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import EditorController from '../Editor/EditorController.mjs'
import ProjectLocator from '../Project/ProjectLocator.mjs'
import Settings from '@overleaf/settings'
import { InvalidZipFileError } from './ArchiveErrors.mjs'
import multer from 'multer'
import lodash from 'lodash'
import { expressify } from '@overleaf/promise-utils'
import { DuplicateNameError } from '../Errors/Errors.js'

const defaultsDeep = lodash.defaultsDeep

async function convertSvgFileToPdf(svgPath, outputPdfPath) {
  const svgContent = await fs.promises.readFile(svgPath, 'utf8')

  return new Promise((resolve, reject) => {
    const pdfStream = fs.createWriteStream(outputPdfPath)
    pdfStream.on('finish', resolve)
    pdfStream.on('error', reject)

    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 })
    doc.pipe(pdfStream)

    doc.addPage({ margin: 0 })
    SVGtoPDF(doc, svgContent, 0, 0, { preserveAspectRatio: 'xMidYMid meet' })
    doc.end()
  })
}

async function convertAndUploadSvgPdf(userId, projectId, folderId, svgName, svgPath) {
  const pdfName = svgName.replace(/\.svg$/i, '.pdf')
  const tempPdfFile = Path.join(
    os.tmpdir(),
    `drawio-svg-convert-${Date.now()}-${uuidv4()}.pdf`
  )
  await convertSvgFileToPdf(svgPath, tempPdfFile)
  try {
    await FileSystemImportManager.promises.addEntity(
      userId,
      projectId,
      folderId,
      pdfName,
      tempPdfFile,
      true
    )
  } finally {
    fs.unlink(tempPdfFile, () => { })
  }
}

const upload = multer(
  defaultsDeep(
    {
      dest: Settings.path.uploadFolder,
      limits: {
        fileSize: Settings.maxUploadSize,
      },
    },
    Settings.multerOptions
  )
)

function uploadProject(req, res, next) {
  const timer = new metrics.Timer('project-upload')
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { path } = req.file
  const name = Path.basename(req.body.name, '.zip')
  return ProjectUploadManager.createProjectFromZipArchive(
    userId,
    name,
    path,
    function (error, project) {
      fs.unlink(path, function () { })
      timer.done()
      if (error != null) {
        logger.error(
          { err: error, filePath: path, fileName: name },
          'error uploading project'
        )
        if (error instanceof InvalidZipFileError) {
          return res.status(422).json({
            success: false,
            error: req.i18n.translate(error.message),
          })
        } else {
          return res.status(500).json({
            success: false,
            error: req.i18n.translate('upload_failed'),
          })
        }
      } else {
        return res.json({ success: true, project_id: project._id })
      }
    }
  )
}

async function uploadFile(req, res, next) {
  const timer = new metrics.Timer('file-upload')
  const name = req.body.name
  const { path } = req.file
  const projectId = req.params.Project_id
  const userId = SessionManager.getLoggedInUserId(req.session)
  let { folder_id: folderId } = req.query
  if (name == null || name.length === 0 || name.length > 150) {
    fs.unlink(path, function () { })
    return res.status(422).json({
      success: false,
      error: 'invalid_filename',
    })
  }

  try {
    // preserve the directory structure from an uploaded folder
    const { relativePath } = req.body
    // NOTE: Uppy sends a "null" string for `relativePath` when the file is not nested in a folder
    if (relativePath && relativePath !== 'null') {
      const { path } = await ProjectLocator.promises.findElement({
        project_id: projectId,
        element_id: folderId,
        type: 'folder',
      })
      const { lastFolder } = await EditorController.promises.mkdirp(
        projectId,
        Path.dirname(Path.join('/', path.fileSystem, relativePath)),
        userId
      )
      folderId = lastFolder._id
    }
  } catch (error) {
    fs.unlink(path, function () { })
    throw error
  }

  const convertSvgToPdf =
    req.query.convert_svg_to_pdf === 'true' ||
    req.query.convert_svg_to_pdf === '1'

  return FileSystemImportManager.addEntity(
    userId,
    projectId,
    folderId,
    name,
    path,
    true,
    function (error, entity) {
      const cleanup = () => fs.unlink(path, function () { })
      timer.done()
      if (error != null) {
        cleanup()
        if (error.name === 'InvalidNameError') {
          return res.status(422).json({
            success: false,
            error: 'invalid_filename',
          })
        } else if (error instanceof DuplicateNameError) {
          return res.status(422).json({
            success: false,
            error: 'duplicate_file_name',
          })
        } else if (error.message === 'project_has_too_many_files') {
          return res.status(422).json({
            success: false,
            error: 'project_has_too_many_files',
          })
        } else if (error.message === 'folder_not_found') {
          return res.status(422).json({
            success: false,
            error: 'folder_not_found',
          })
        } else {
          logger.error(
            {
              err: error,
              projectId,
              filePath: path,
              fileName: name,
              folderId,
            },
            'error uploading file'
          )
          return res.status(422).json({ success: false })
        }
      } else {
        if (convertSvgToPdf && name.toLowerCase().endsWith('.svg')) {
          convertAndUploadSvgPdf(userId, projectId, folderId, name, path)
            .catch(err => {
              logger.error(
                {
                  err,
                  projectId,
                  filePath: path,
                  fileName: name,
                  folderId,
                },
                'failed converting SVG to PDF'
              )
            })
            .finally(cleanup)
        } else {
          cleanup()
        }

        return res.json({
          success: true,
          entity_id: entity?._id,
          entity_type: entity?.type,
          hash: entity?.hash,
        })
      }
    }
  )
}

function multerMiddleware(req, res, next) {
  if (upload == null) {
    return res
      .status(500)
      .json({ success: false, error: req.i18n.translate('upload_failed') })
  }
  return upload.single('qqfile')(req, res, function (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(422)
        .json({ success: false, error: req.i18n.translate('file_too_large') })
    }
    if (err) return next(err)
    if (!req.file?.path) {
      logger.info({ req }, 'missing req.file.path on upload')
      return res
        .status(400)
        .json({ success: false, error: 'invalid_upload_request' })
    }
    next()
  })
}

export default {
  uploadProject,
  uploadFile: expressify(uploadFile),
  multerMiddleware,
}
