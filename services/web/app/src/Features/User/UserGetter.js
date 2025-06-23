const { callbackify } = require('util')
const { db } = require('../../infrastructure/mongodb')
const moment = require('moment')
const settings = require('@overleaf/settings')
const { promisifyAll } = require('@overleaf/promise-utils')
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

  return decorateFullEmails(
    user.email,
    user.emails || [],
    affiliationsData,
    user.samlIdentifiers || []
  )
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

  getUser(query, projection, callback) {
    if (arguments.length === 2) {
      callback = projection
      projection = {}
    }
    try {
      query = normalizeQuery(query)
      db.users.findOne(query, { projection }, callback)
    } catch (err) {
      callback(err)
    }
  },

  getUserFeatures: callbackify(getUserFeatures),

  getUserEmail(userId, callback) {
    this.getUser(userId, { email: 1 }, (error, user) =>
      callback(error, user && user.email)
    )
  },

  getUserFullEmails: callbackify(getUserFullEmails),

  getUserConfirmedEmails: callbackify(getUserConfirmedEmails),

  getUserByMainEmail(email, projection, callback) {
    email = email.trim()
    if (arguments.length === 2) {
      callback = projection
      projection = {}
    }
    db.users.findOne({ email }, { projection }, callback)
  },

  getUserByAnyEmail(email, projection, callback) {
    email = email.trim()
    if (arguments.length === 2) {
      callback = projection
      projection = {}
    }
    // $exists: true MUST be set to use the partial index
    const query = { emails: { $exists: true }, 'emails.email': email }
    db.users.findOne(query, { projection }, (error, user) => {
      if (error || user) {
        return callback(error, user)
      }

      // While multiple emails are being rolled out, check for the main email as
      // well
      this.getUserByMainEmail(email, projection, callback)
    })
  },

  getUsersByAnyConfirmedEmail(emails, projection, callback) {
    if (arguments.length === 2) {
      callback = projection
      projection = {}
    }

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

    db.users.find(query, { projection }).toArray(callback)
  },

  getUsersByV1Ids(v1Ids, projection, callback) {
    if (arguments.length === 2) {
      callback = projection
      projection = {}
    }
    const query = { 'overleaf.id': { $in: v1Ids } }
    db.users.find(query, { projection }).toArray(callback)
  },

  getUsersByHostname(hostname, projection, callback) {
    const reversedHostname = hostname.trim().split('').reverse().join('')
    const query = {
      emails: { $exists: true },
      'emails.reversedHostname': reversedHostname,
    }
    db.users.find(query, { projection }).toArray(callback)
  },

  getInstitutionUsersByHostname(hostname, callback) {
    const projection = {
      _id: 1,
      email: 1,
      emails: 1,
      samlIdentifiers: 1,
    }
    UserGetter.getUsersByHostname(hostname, projection, (err, users) => {
      if (err) return callback(err)

      users.forEach(user => {
        user.emails = decorateFullEmails(
          user.email,
          user.emails,
          [],
          user.samlIdentifiers || []
        )
      })
      callback(null, users)
    })
  },

  getUsers(query, projection, callback) {
    try {
      query = normalizeMultiQuery(query)
      db.users.find(query, { projection }).toArray(callback)
    } catch (err) {
      callback(err)
    }
  },

  // check for duplicate email address. This is also enforced at the DB level
  ensureUniqueEmailAddress(newEmail, callback) {
    this.getUserByAnyEmail(newEmail, function (error, user) {
      if (user) {
        return callback(new Errors.EmailExistsError())
      }
      callback(error)
    })
  },
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

UserGetter.promises = promisifyAll(UserGetter, {
  without: [
    'getSsoUsersAtInstitution',
    'getUserFullEmails',
    'getUserFeatures',
    'getWritefullData',
  ],
})
UserGetter.promises.getUserFullEmails = getUserFullEmails
UserGetter.promises.getSsoUsersAtInstitution = getSsoUsersAtInstitution
UserGetter.promises.getUserFeatures = getUserFeatures
UserGetter.promises.getWritefullData = getWritefullData

module.exports = UserGetter
