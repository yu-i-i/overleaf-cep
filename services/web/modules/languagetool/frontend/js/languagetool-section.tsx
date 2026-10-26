/**
 * LanguageTool settings section hook — registers the LanguageTool settings in
 * the Settings modal (Spelling and Language tab) through the
 * `settingsModalSpellcheckSections` slot.
 *
 * Signature required by the slot consumer: a default-exported function that
 * returns a SettingsSection (or null).
 */

import type { SettingsSection } from '@/features/ide-settings/context/types'
import LanguageToolSettings from './components/languagetool-settings'

export default function languageToolSection(): SettingsSection {
  return {
    key: 'languagetool',
    title: 'LanguageTool',
    settings: [
      {
        key: 'languagetool-settings',
        component: <LanguageToolSettings />,
      },
    ],
  }
}
