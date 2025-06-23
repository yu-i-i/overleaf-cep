const { callbackify } = require('util')
const { db } = require('../../infrastructure/mongodb')
const moment = require('moment')
const settings = require('@overleaf/settings')
const {
  promises: InstitutionsAPIPromises,
} = require('../Institutions/InstitutionsAPI')
const InstitutionsHelper = require('../Institutions/InstitutionsHelper')
const Errors = require('../Errors/Errors')
const Features = require('../../infrastructure/Features')
const { User } = require('../../models/User')
const { normalizeQuery, normalizeMultiQuery } = require('../Helpers/Mongo')
const Modules = require('../../infrastructure/Modules')
const FeaturesHelper = require('../Subscription/FeaturesHelper')
const AsyncLocalStorage = require('../../infrastructure/AsyncLocalStorage')

function _lastDayToReconfirm(emailData, institutionData) {
  const globalReconfirmPeriod = settings.reconfirmNotificationDays
  if (!globalReconfirmPeriod) return undefined

  // only show notification for institutions with reconfirmation enabled
  if (!institutionData || !institutionData.maxConfirmationMonths)
    return undefined

  if (!emailData.confirmedAt) return undefined

  if (institutionData.ssoEnabled && !emailData.samlProviderId) {
    // For SSO, only show notification for linked email
    return false
  }

  // reconfirmedAt will not always be set, use confirmedAt as fallback
  const lastConfirmed = emailData.reconfirmedAt || emailData.confirmedAt

  return moment(lastConfirmed)
    .add(institutionData.maxConfirmationMonths, 'months')
    .toDate()
}

function _pastReconfirmDate(lastDayToReconfirm) {
  if (!lastDayToReconfirm) return false
  return moment(lastDayToReconfirm).isBefore()
}

function _emailInReconfirmNotificationPeriod(
  cachedLastDayToReconfirm,
  lastDayToReconfirm
) {
  const globalReconfirmPeriod = settings.reconfirmNotificationDays

  if (!globalReconfirmPeriod || !cachedLastDayToReconfirm) return false

  const notificationStarts = moment(cachedLastDayToReconfirm).subtract(
    globalReconfirmPeriod,
    'days'
  )

  let isInNotificationPeriod = moment().isAfter(notificationStarts)

  if (!isInNotificationPeriod) {
    // for possible issues in v1/v2 date mismatch, ensure v2 date doesn't show as needing to reconfirm

    const notificationStartsV2 = moment(lastDayToReconfirm).subtract(
      globalReconfirmPeriod,
      'days'
    )

    isInNotificationPeriod = moment().isAfter(notificationStartsV2)
  }

  return isInNotificationPeriod
}

async function getUserFullEmails(userId) {
  const store = AsyncLocalStorage.storage.getStore()
  if (store?.userFullEmails?.[userId]) {
    return store.userFullEmails[userId]
  }
  const user = await UserGetter.promises.getUser(userId, {
    email: 1,
    emails: 1,
    samlIdentifiers: 1,
  })

  if (!user) {
    throw new Error('User not Found')
  }

  if (!Features.hasFeature('affiliations')) {
    return decorateFullEmails(user.email, user.emails, [], [])
  }

  const affiliationsData =
    await InstitutionsAPIPromises.getUserAffiliations(userId)

  const fullEmails = decorateFullEmails(
    user.email,
    user.emails || [],
    affiliationsData,
    user.samlIdentifiers || []
  )

  if (store) {
    if (!store.userFullEmails) {
      store.userFullEmails = {}
    }
    store.userFullEmails[userId] = fullEmails
  }
  return fullEmails
}

async function getUserFeatures(userId) {
  const user = await UserGetter.promises.getUser(userId, {
    features: 1,
  })
  if (!user) {
    throw new Error('User not Found')
  }

  const moduleFeatures =
    (await Modules.promises.hooks.fire('getModuleProvidedFeatures', userId)) ||
    []

  return FeaturesHelper.computeFeatureSet([user.features, ...moduleFeatures])
}

async function getUserConfirmedEmails(userId) {
  const user = await UserGetter.promises.getUser(userId, {
    emails: 1,
  })

  if (!user) {
    throw new Error('User not Found')
  }

  return user.emails.filter(email => !!email.confirmedAt)
}

async function getSsoUsersAtInstitution(institutionId, projection) {
  if (!projection) {
    throw new Error('missing projection')
  }

  return await User.find(
    {
      'samlIdentifiers.providerId': institutionId.toString(),
    },
    projection
  ).exec()
}

async function getWritefullData(userId) {
  const user = await UserGetter.promises.getUser(userId, {
    writefull: 1,
  })
  if (!user) {
    throw new Error('user not found')
  }
  return {
    isPremium: Boolean(user?.writefull?.isPremium),
    premiumSource: user?.writefull?.premiumSource || null,
  }
}

async function getUser(query, projection = {}) {
  query = normalizeQuery(query)
  return await db.users.findOne(query, { projection })
}

async function getUserEmail(userId) {
  const user = await UserGetter.promises.getUser(userId, { email: 1 })
  return user && user.email
}

async function getUserByMainEmail(email, projection = {}) {
  email = email.trim()
  return await db.users.findOne({ email }, { projection })
}

async function getUserByAnyEmail(email, projection = {}) {
  email = email.trim()

  // $exists: true MUST be set to use the partial index
  const query = { emails: { $exists: true }, 'emails.email': email }
  const user = await db.users.findOne(query, { projection })
  if (user) return user

  // While multiple emails are being rolled out, check for the main email as
  // well
  return await getUserByMainEmail(email, projection)
}

async function getUsersByAnyConfirmedEmail(emails, projection = {}) {
  const query = {
    'emails.email': { $in: emails }, // use the index on emails.email
    emails: {
      $exists: true,
      $elemMatch: {
        email: { $in: emails },
        confirmedAt: { $exists: true },
      },
    },
  }

  return await db.users.find(query, { projection }).toArray()
}

async function getUsersByV1Ids(v1Ids, projection = {}) {
  const query = { 'overleaf.id': { $in: v1Ids } }
  return await db.users.find(query, { projection }).toArray()
}

async function getUsersByHostname(hostname, projection) {
  const reversedHostname = hostname.trim().split('').reverse().join('')
  const query = {
    emails: { $exists: true },
    'emails.reversedHostname': reversedHostname,
  }
  return await db.users.find(query, { projection }).toArray()
}

async function getInstitutionUsersByHostname(hostname) {
  const projection = {
    _id: 1,
    email: 1,
    emails: 1,
    samlIdentifiers: 1,
  }

  const users = await UserGetter.promises.getUsersByHostname(
    hostname,
    projection
  )
  users.forEach(user => {
    user.emails = decorateFullEmails(
      user.email,
      user.emails,
      [],
      user.samlIdentifiers || []
    )
  })
  return users
}

async function getUsers(query, projection) {
  query = normalizeMultiQuery(query)
  if (query?._id?.$in?.length === 0) return [] // shortcut for getUsers([])
  return await db.users.find(query, { projection }).toArray()
}

// check for duplicate email address. This is also enforced at the DB level
async function ensureUniqueEmailAddress(newEmail) {
  const user = await UserGetter.promises.getUserByAnyEmail(newEmail)
  if (user) {
    throw new Errors.EmailExistsError()
  }
}

getTotalProjectStorageForUser = async function (userId) {
  const ProjectEntityHandler = require('../Project/ProjectEntityHandler')
  const { Project } = require('../../models/Project')
  const fs = require('fs')
  const path = require('path')

  let totalsize = 0
  // only owned projects, not shared
  const ownedProjects = await Project.find(
    { owner_ref: userId },
    "_id"
  ).exec() 

  for (let i = 0; i < ownedProjects.length; i++) {
    const project = ownedProjects[i]
    const files = await ProjectEntityHandler.promises.getAllFiles(project._id)

    for (const [filePath, file] of Object.entries(files)) {
      const f = path.join(settings.filestore.stores.user_files, project._id.toString() + '_' + file._id.toString())

      const fstat = await fs.promises.stat(f)
      const fsize = fstat.size
      totalsize += fsize
    }
  } // foreach Project
  return { count: ownedProjects.length, total: totalsize } // bytes
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024
    i++
  }
  return `${bytes.toFixed(2)} ${units[i]}`
}

const UserGetter = {
  getSsoUsersAtInstitution: callbackify(getSsoUsersAtInstitution),
  getUser: callbackify(getUser),
  getUserFeatures: callbackify(getUserFeatures),
  getUserEmail: callbackify(getUserEmail),
  getUserFullEmails: callbackify(getUserFullEmails),
  getUserConfirmedEmails: callbackify(getUserConfirmedEmails),
  getUserByMainEmail: callbackify(getUserByMainEmail),
  getUserByAnyEmail: callbackify(getUserByAnyEmail),
  getUsersByAnyConfirmedEmail: callbackify(getUsersByAnyConfirmedEmail),
  getUsersByV1Ids: callbackify(getUsersByV1Ids),
  getUsersByHostname: callbackify(getUsersByHostname),
  getInstitutionUsersByHostname: callbackify(getInstitutionUsersByHostname),
  getUsers: callbackify(getUsers),
  // check for duplicate email address. This is also enforced at the DB level
  ensureUniqueEmailAddress: callbackify(ensureUniqueEmailAddress),
  getWritefullData: callbackify(getWritefullData),

  getAllUsers(callback) {    
    const projection = {
      _id: 1,
      email: 1,
      first_name: 1,
      last_name: 1,
      lastLoggedIn: 1,
      signUpDate: 1,
      loginCount: 1,
      isAdmin: 1,
      suspended: 1,
      institution: 1,
    }    

    const query = { $or: [{ 'emails.email': { $exists: true } },], }

    db.users.find(query, {projection: projection}).toArray(async (err, users) => {
      if (err) {
        console.error('Error fetching users:', err)
        return callback(err)
      }
      for (let i = 0; i < users.length; i++) {
        const user = users[i]
        user.signUpDateformatted = moment(user.signUpDate).format('DD/MM/YYYY')
        user.lastLoggedInformatted = moment(user.lastLoggedIn).format('DD/MM/YYYY')
        const ProjectsInfo = await getTotalProjectStorageForUser(user._id)
        
        user.projectsSize = ProjectsInfo.total
        user.projectsSizeFormatted = formatBytes(ProjectsInfo.total)
        user.projectsCount = ProjectsInfo.count
      }

      callback(null, users)
    })

  }
}

const decorateFullEmails = (
  defaultEmail,
  emailsData,
  affiliationsData,
  samlIdentifiers
) => {
  emailsData.forEach(function (emailData) {
    emailData.default = emailData.email === defaultEmail

    const affiliation = affiliationsData.find(
      aff => aff.email === emailData.email
    )
    if (affiliation) {
      const {
        institution,
        inferred,
        role,
        department,
        licence,
        cached_confirmed_at: cachedConfirmedAt,
        cached_reconfirmed_at: cachedReconfirmedAt,
        past_reconfirm_date: cachedPastReconfirmDate,
        entitlement: cachedEntitlement,
        portal,
        group,
      } = affiliation
      const lastDayToReconfirm = _lastDayToReconfirm(emailData, institution)
      let { last_day_to_reconfirm: cachedLastDayToReconfirm } = affiliation
      if (institution.ssoEnabled && !emailData.samlProviderId) {
        // only SSO linked emails are reconfirmed at SSO institutions
        cachedLastDayToReconfirm = undefined
      }
      const pastReconfirmDate = _pastReconfirmDate(lastDayToReconfirm)
      const inReconfirmNotificationPeriod = _emailInReconfirmNotificationPeriod(
        cachedLastDayToReconfirm,
        lastDayToReconfirm
      )
      emailData.affiliation = {
        institution,
        inferred,
        inReconfirmNotificationPeriod,
        lastDayToReconfirm,
        cachedConfirmedAt,
        cachedLastDayToReconfirm,
        cachedReconfirmedAt,
        cachedEntitlement,
        cachedPastReconfirmDate,
        pastReconfirmDate,
        role,
        department,
        licence,
        portal,
      }
      if (group) {
        emailData.affiliation.group = group
      }
    }

    if (emailData.samlProviderId) {
      emailData.samlIdentifier = samlIdentifiers.find(
        samlIdentifier => samlIdentifier.providerId === emailData.samlProviderId
      )
    }

    emailData.emailHasInstitutionLicence =
      InstitutionsHelper.emailHasLicence(emailData)

    const lastConfirmedAtStr = emailData.reconfirmedAt || emailData.confirmedAt
    emailData.lastConfirmedAt = lastConfirmedAtStr
      ? moment(lastConfirmedAtStr).toDate()
      : null
  })

  return emailsData
}

UserGetter.promises = {
  getSsoUsersAtInstitution,
  getUser,
  getUserFeatures,
  getUserEmail,
  getUserFullEmails,
  getUserConfirmedEmails,
  getUserByMainEmail,
  getUserByAnyEmail,
  getUsersByAnyConfirmedEmail,
  getUsersByV1Ids,
  getUsersByHostname,
  getInstitutionUsersByHostname,
  getUsers,
  ensureUniqueEmailAddress,
  getWritefullData,
}

module.exports = UserGetter
