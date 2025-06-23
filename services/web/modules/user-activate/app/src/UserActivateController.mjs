import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import UserGetter from '../../../../app/src/Features/User/UserGetter.js'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.js'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.js'
import { expressify } from '@overleaf/promise-utils'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

function registerNewUser(req, res, next) {
  res.render(Path.resolve(__dirname, '../views/user/register'))
}

async function register(req, res, next) {
  const { email } = req.body
  if (email == null || email === '') {
    return res.sendStatus(422) // Unprocessable Entity
  }
  const { user, setNewPasswordUrl } =
    await UserRegistrationHandler.promises.registerNewUserAndSendActivationEmail(
      email
    )
  res.json({
    email: user.email,
    setNewPasswordUrl,
  })
}

async function activateAccountPage(req, res, next) {
  // An 'activation' is actually just a password reset on an account that
  // was set with a random password originally.
  if (req.query.user_id == null || req.query.token == null) {
    return ErrorController.notFound(req, res)
  }

  if (typeof req.query.user_id !== 'string') {
    return ErrorController.forbidden(req, res)
  }

  const user = await UserGetter.promises.getUser(req.query.user_id, {
    email: 1,
    loginCount: 1,
  })

  if (!user) {
    return ErrorController.notFound(req, res)
  }

  if (user.loginCount > 0) {
    // Already seen this user, so account must be activated.
    // This lets users keep clicking the 'activate' link in their email
    // as a way to log in which, if I know our users, they will.
    return res.redirect(`/login`)
  }

  req.session.doLoginAfterPasswordReset = true

  res.render(Path.resolve(__dirname, '../views/user/activate'), {
    title: 'activate_account',
    email: user.email,
    token: req.query.token,
  })
}

// 
async function listAllUsers(req, res, next) {
  const users = await UserGetter.promises.getAllUsers()

  res.render(Path.resolve(__dirname, '../views/user/list'), {
    title: 'Users list',
    users,
    currentUserId: req.user._id,
    _csrf: req.csrfToken(),
  })
}

import UserUpdater from '../../../../app/src/Features/User/UserUpdater.js'
/* 
 * it is a modified copy of /overleaf/services/web/scripts/suspend_users.mjs
 * @param {request} req
 * @param {response} res
 */
async function suspendUser(req, res) {
  const userId = req.params.userId

  try {
    await UserUpdater.promises.suspendUser(userId, {
      initiatorId: userId,
      ip: req.ip,
      info: { script: false },
    })
  } catch (error) {
    console.log(`Failed to suspend ${userId}`, error)
  }

  res.redirect('/admin/users')
}

/* 
  * it is a modified copy of UserUpdater.suspendUser
  * @param {request} req
  * @param {response} res
  */
async function unsuspendUser(req, res) {  
  const userId = req.params.userId
  const upd = await UserUpdater.promises.updateUser(
    { _id: userId, suspended: { $ne: false } },
    { $set: { suspended: false } }
  )
  if (upd.matchedCount !== 1) {
    console.log('user id not found or already unsuspended')
  }

  res.redirect('/admin/users')
}

/* 
 * it is a modified copy of UserUpdater.suspendUser
 * It is used to update user first and last name
 * @param {request} req.body.userId
 * @param {request} req.body.first_name
 * @param {request} req.body.last_name    
 * @param {response} res  
 */
async function updateUser(req, res) {
  const { userId, first_name, last_name } = req.body;
  const upd = await UserUpdater.promises.updateUser(
    { _id: userId },
    { $set: { 
      first_name: first_name, 
      last_name: last_name,
      } }
  )
  if (upd.matchedCount !== 1) {
    console.log(`user id not found ${userId}`) 
  } else {
    res.json({ success: true });
  }  
}

export default {
  registerNewUser,
  register: expressify(register),
  activateAccountPage: expressify(activateAccountPage),
  listAllUsers: expressify(listAllUsers),
  suspendUser: expressify(suspendUser),
  unsuspendUser: expressify(unsuspendUser),
  updateUser: expressify(updateUser),
}
