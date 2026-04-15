import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectAuditLogHandler from '../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import {
    RateLimiter,
} from '../../../../app/src/infrastructure/RateLimiter.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import fs from 'node:fs'
import path from 'node:path'
import _ from 'lodash'
import { User } from '../../../../app/src/models/User.mjs'

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

const createTypstProjectRateLimiter = new RateLimiter('create-typst-project', {
    points: 20,
    duration: 60,
})

async function _buildTypstTemplate(userId, projectName) {
    const user = await User.findById(userId, 'first_name last_name')
    const templatePath = path.join(
        import.meta.dirname,
        '../../templates/project_files/mainbasic.typ'
    )
    const template = fs.readFileSync(templatePath)
    const data = {
        project_name: projectName,
        user,
        year: new Date().getUTCFullYear(),
        month: MONTH_NAMES[new Date().getUTCMonth()],
    }
    const output = _.template(template.toString())(data)
    return output.split('\n')
}

async function newTypstProject(req, res) {
    const currentUser = SessionManager.getSessionUser(req.session)
    const {
        first_name: firstName,
        last_name: lastName,
        email,
        _id: userId,
    } = currentUser
    const projectName =
        req.body.projectName != null ? req.body.projectName.trim() : undefined

    // Create a blank project first
    const project = await ProjectCreationHandler.promises.createBlankProject(
        userId,
        projectName,
        { compiler: 'typst' }
    )

    // Build typst template and create the root doc
    const docLines = await _buildTypstTemplate(userId, projectName)
    const ProjectEntityUpdateHandler = (
        await import('../../../../app/src/Features/Project/ProjectEntityUpdateHandler.mjs')
    ).default
    const { doc } = await ProjectEntityUpdateHandler.promises.addDoc(
        project._id,
        project.rootFolder[0]._id,
        'main.typ',
        docLines,
        userId,
        null
    )

    // Set as root doc and compiler
    await Project.updateOne(
        { _id: project._id },
        { rootDoc_id: doc._id, compiler: 'typst' }
    )

    ProjectAuditLogHandler.addEntryIfManagedInBackground(
        project._id,
        'project-created',
        project.owner_ref,
        req.ip
    )

    res.json({
        project_id: project._id,
        owner_ref: project.owner_ref,
        owner: {
            first_name: firstName,
            last_name: lastName,
            email,
            _id: userId,
        },
    })
}

const TypstRouter = {
    apply(webRouter) {
        logger.debug({}, 'Init typst router')
        webRouter.post(
            '/project/new/typst',
            AuthenticationController.requireLogin(),
            RateLimiterMiddleware.rateLimit(createTypstProjectRateLimiter),
            expressify(newTypstProject)
        )
    },
}

export default TypstRouter
