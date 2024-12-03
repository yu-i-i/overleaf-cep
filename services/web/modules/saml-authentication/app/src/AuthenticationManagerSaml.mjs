import Settings from '@overleaf/settings'
import UserCreator from '../../../../app/src/Features/User/UserCreator.js'
import { User } from '../../../../app/src/models/User.js'

const AuthenticationManagerSaml = {
  async findOrCreateSamlUser(profile, auditLog) {
    const {
      attEmail,
      attFirstName,
      attLastName,
      attAdmin,
      valAdmin,
      updateUserDetailsOnLogin,
    } = Settings.saml
    const email = Array.isArray(profile[attEmail])
                    ? profile[attEmail][0].toLowerCase()
                    : profile[attEmail].toLowerCase()
    const firstName = attFirstName ? profile[attFirstName] : ""
    const lastName  = attLastName  ? profile[attLastName] : email
    let isAdmin = false
    if( attAdmin && valAdmin ) {
      isAdmin = (Array.isArray(profile[attAdmin]) ? profile[attAdmin].includes(valAdmin) :
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
      ).exec() //email of saml user is confirmed
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
  promises: AuthenticationManagerSaml,
}
