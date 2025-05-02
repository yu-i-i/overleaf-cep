import Settings from '@overleaf/settings'
import TemplateGalleryRouter from './app/src/TemplateGalleryRouter.mjs'
const TemplateGalleryModule = {
  router: TemplateGalleryRouter,
}

function boolFromEnv(env) {
  if (env === undefined || env === null) return undefined
  if (typeof env === "string") {
    const envLower = env.toLowerCase()
    if (envLower === 'true') return true
    if (envLower === 'false') return false
  }
  throw new Error("Invalid value for boolean envirionment variable")
}

Settings.templates = {
  nonAdminCanManage: boolFromEnv(process.env.OVERLEAF_NON_ADMIN_CAN_MANAGE_TEMPLATES)
}

Settings.templateLinks = (`${process.env.OVERLEAF_TEMPLATE_KEYS} all`).split(/\s+/).map(key => {
  const envKeyBase = key.toUpperCase().replace(/-/g, "_")
  const name = process.env[`TEMPLATE_${envKeyBase}_NAME`]
  const description = process.env[`TEMPLATE_${envKeyBase}_DESCRIPTION`]

  return {
    name: name || key,
    url: `/templates/${key}`,
    description: description || "Templates category"
  }
})

export default TemplateGalleryModule
