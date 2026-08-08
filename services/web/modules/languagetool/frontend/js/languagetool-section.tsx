/**
 * LanguageTool settings section hook — registers the LanguageTool setting in
 * the Settings modal through the `settingsModalSpellcheckSections` slot.
 */

import type { SettingsSection } from '@/features/settings/context/types'
import LanguageToolLanguageSetting from './components/languagetool-language-setting'

export default function languageToolSection(): SettingsSection {
  return {
    key: 'languagetool',
    title: 'Language Tool',
    settings: [
      {
        key: 'languagetool-settings',
        component: <LanguageToolLanguageSetting />
      },
    ],
  }
}
