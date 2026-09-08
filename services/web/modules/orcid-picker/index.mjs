import OrcidPickerRouter from './app/src/OrcidPickerRouter.mjs'

/** @import { WebModule } from "../../types/web-module" */

/**
 * orcid-picker module.
 *
 *  - "Import from ORCID" — proxy the public ORCID APIs
 *    (https://pub.orcid.org/v3.0) server-side (search by name, list works,
 *    fetch BibTeX per work) and expose a picker modal that the bib-editor
 *    Add menus (project and library) open.
 *
 * Server-side only registration: the frontend modal is imported directly
 * by the bib-editor module components (see bib-editor-panel.tsx and
 * library-page.tsx). Registered in `settings.defaults.js`
 * (`moduleImportSequence`).
 *
 * Gating: ON by default in CE (no extra env var — it adds only three
 * login-required GET routes that proxy pub.orcid.org with SSRF + size +
 * time guards).
 */
const OrcidPickerModule = {
  router: OrcidPickerRouter,
}

export default OrcidPickerModule
