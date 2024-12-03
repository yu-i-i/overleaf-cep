import Settings from '@overleaf/settings'
import { callbackify } from '@overleaf/promise-utils'
import UserCreator from '../../../../app/src/Features/User/UserCreator.js'
import { User } from '../../../../app/src/models/User.js'

const AuthenticationManagerLdap = {
  splitFullName(fullName) {
    fullName = fullName.trim();
    let lastSpaceIndex = fullName.lastIndexOf(' ');
    let firstNames = fullName.substring(0, lastSpaceIndex).trim();
    let lastName = fullName.substring(lastSpaceIndex + 1).trim();
    return [firstNames, lastName];
  },
  async findOrCreateLdapUser(profile, auditLog) {
    //user is already authenticated in Ldap
    const {
      attEmail,
      attFirstName,
      attLastName,
      attName,
      attAdmin,
      valAdmin,
      updateUserDetailsOnLogin,
    } = Settings.ldap

    const email = Array.isArray(profile[attEmail])
                    ? profile[attEmail][0].toLowerCase()
                    : profile[attEmail].toLowerCase()
    let nameParts = ["",""]
    if ((!attFirstName || !attLastName) && attName) {
      nameParts = this.splitFullName(profile[attName] || "")
    }
    const firstName = attFirstName ? (profile[attFirstName] || "") : nameParts[0]
    let   lastName  = attLastName  ? (profile[attLastName]  || "") : nameParts[1]
    if (!firstName && !lastName) lastName = email
    let isAdmin = false
    if( attAdmin && valAdmin ) {
      isAdmin = (profile._groups?.length > 0) ||
                (Array.isArray(profile[attAdmin]) ? profile[attAdmin].includes(valAdmin) :
                                                    profile[attAdmin] === valAdmin)
    }
    let user = await User.findOne({ 'email': email }).exec()
    if( !user ) {
      user = await UserCreator.promises.createNewUser(
        {
          email: email,
          first_name: firstName,
          last_name: lastName,
          isAdmin: isAdmin,
          holdingAccount: false,
        }
      )
      await User.updateOne(
        { _id: user._id },
        { $set : { 'emails.0.confirmedAt' : Date.now() } }
      ).exec() //email of ldap user is confirmed
    }
    let userDetails = updateUserDetailsOnLogin ? { first_name : firstName, last_name: lastName } : {}
    if( attAdmin && valAdmin ) {
      user.isAdmin = isAdmin
      userDetails.isAdmin = isAdmin
    }
    const result = await User.updateOne(
      { _id: user._id, loginEpoch: user.loginEpoch }, { $inc: { loginEpoch: 1 }, $set: userDetails },
      {}
    ).exec()
    if (result.modifiedCount !== 1) {
      throw new ParallelLoginError()
    }
    return user
  },
}

export default {
  findOrCreateLdapUser: callbackify(AuthenticationManagerLdap.findOrCreateLdapUser),
  promises: AuthenticationManagerLdap,
}
export const {
  splitFullName,
} = AuthenticationManagerLdap
