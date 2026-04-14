/**
 * Rail entry definition for the bib-editor module.
 * This file is referenced by settings.defaults.js in the railEntries array.
 * It exports a default RailElement that the rail.tsx component will include.
 */
import React from 'react'
import BibEditorPanel from '../components/bib-editor-panel'
import '../components/bib-editor-panel.css'
import type { RailTabKey } from '@/features/ide-react/context/rail-context'

const railEntry = {
  key: 'bib-editor' as RailTabKey,
  icon: 'book_5' as const,
  title: 'Bibliography',
  component: <BibEditorPanel />,
}

export default railEntry
