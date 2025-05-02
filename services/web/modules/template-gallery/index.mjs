import Settings from '@overleaf/settings'
import TemplateGalleryRouter from './app/src/TemplateGalleryRouter.mjs'

function boolFromEnv(env) {
  if (env === undefined || env === null) return undefined
  if (typeof env === "string") {
    const envLower = env.toLowerCase()
    if (envLower === 'true') return true
    if (envLower === 'false') return false
  }
  throw new Error("Invalid value for boolean environment variable")
}

let TemplateGalleryModule = {}

if (process.env.OVERLEAF_TEMPLATE_GALLERY === 'true') {
  TemplateGalleryModule = {
    router: TemplateGalleryRouter,
  }

  Settings.templates = {
    nonAdminCanManage: boolFromEnv(process.env.OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES)
  }

  const templateKeys = process.env.OVERLEAF_TEMPLATE_CATEGORIES
    ? process.env.OVERLEAF_TEMPLATE_CATEGORIES + ' all'
    : 'all'

  Settings.templateLinks = templateKeys.split(/\s+/).map(key => {
    const envKeyBase = key.toUpperCase().replace(/-/g, "_")
    const name = process.env[`TEMPLATE_${envKeyBase}_NAME`] || ( key === 'all' ? 'All templates' : key)
    const description = process.env[`TEMPLATE_${envKeyBase}_DESCRIPTION`] || ''

    return {
      name,
      url: `/templates/${key}`,
      description
    }
  })
}

export default TemplateGalleryModule
