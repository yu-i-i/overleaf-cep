import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import UserGetter from '../../../../app/src/Features/User/UserGetter.js'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.js'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.js'
import UserUpdater from '../../../../app/src/Features/User/UserUpdater.js'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.js'
import { expressify } from '@overleaf/promise-utils'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

async function registerNewUser(req, res, next) {
  try {
    // Fetch users with isAdmin field
    const users = await UserGetter.promises.getUsers(
      {},
      { _id: 1, first_name: 1, last_name: 1, email: 1, isAdmin: 1 }
    )
    // Prepare user data for client-side rendering
    const userData = users.map(user => ({
      id: user._id.toString(),
      lastName: user.last_name || 'N/A',
      firstName: user.first_name || 'N/A',
      email: user.email || 'N/A',
      isAdmin: user.isAdmin || false,
    }))
    // Render the React layout and pass the user list
    res.render(
      Path.resolve(__dirname, '../views/user/register'),
      {
        userList: JSON.stringify(userData),
      }
    )
  } catch (err) {
    next(err)
  }
}

async function register(req, res, next) {
  const { email } = req.body
  if (email == null || email === '') {
    return res.sendStatus(422)
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

async function toggleAdminStatus(req, res, next) {
  const { userId } = req.params
  const { isAdmin } = req.body
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' })
  }

  if (typeof isAdmin !== 'boolean') {
    return res.status(400).json({ error: 'isAdmin must be a boolean' })
  }

  try {
    const user = await UserGetter.promises.getUser(userId, { _id: 1, email: 1 })
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Prevent admins from removing their own admin status
    if (req.user._id.toString() === userId && !isAdmin) {
      return res.status(403).json({ 
        error: 'Cannot remove your own admin privileges' 
      })
    }

    await UserUpdater.promises.updateUser(userId, {
      $set: { isAdmin }
    })

    res.json({ 
      success: true, 
      message: `User ${user.email} admin status updated to ${isAdmin}` 
    })
  } catch (err) {
    console.error('Error updating admin status:', err)
    res.status(500).json({ 
      error: 'Failed to update admin status',
      message: err.message 
    })
  }
}

async function deleteUser(req, res, next) {
  const { userId } = req.params
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' })
  }

  try {
    const user = await UserGetter.promises.getUser(userId, { _id: 1, email: 1, isAdmin: 1 })
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Prevent admins from deleting themselves
    if (req.user._id.toString() === userId) {
      return res.status(403).json({ 
        error: 'Cannot delete your own account' 
      })
    }

    const options = {
      ipAddress: req.ip || '0.0.0.0',
      force: true,
      skipEmail: false,
    }

    await new Promise((resolve, reject) => {
      UserDeleter.deleteUser(user._id, options, function (err) {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })

    res.json({ 
      success: true, 
      message: `User ${user.email} has been deleted successfully` 
    })
  } catch (err) {
    console.error('Error deleting user:', err)
    res.status(500).json({ 
      error: 'Failed to delete user',
      message: err.message 
    })
  }
}

async function activateAccountPage(req, res, next) {
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
    return res.redirect(`/login`)
  }
  req.session.doLoginAfterPasswordReset = true
  res.render(Path.resolve(__dirname, '../views/user/activate'), {
    title: 'activate_account',
    email: user.email,
    token: req.query.token,
  })
}

export default {
  registerNewUser: expressify(registerNewUser),
  register: expressify(register),
  toggleAdminStatus: expressify(toggleAdminStatus),
  deleteUser: expressify(deleteUser),
  activateAccountPage: expressify(activateAccountPage),
}
