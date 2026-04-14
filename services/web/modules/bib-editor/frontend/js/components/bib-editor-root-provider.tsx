/**
 * Root context provider for the bib-editor module.
 * This file is referenced by settings.defaults.js in the rootContextProviders array.
 * It wraps the entire app with the BibEditor context so the sidebar and
 * CodeMirror extension can communicate.
 */
export { default } from '../context/bib-editor-provider'
