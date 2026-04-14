import SSOAdminRouter from './app/src/SSOAdminRouter.mjs'
import EmailAdminRouter from './app/src/EmailAdminRouter.mjs'

const AdminModule = {
  name: 'admin',
  router: {
    apply(webRouter) {
      SSOAdminRouter.apply(webRouter)
      EmailAdminRouter.apply(webRouter)
    },
  },
}

export default AdminModule
