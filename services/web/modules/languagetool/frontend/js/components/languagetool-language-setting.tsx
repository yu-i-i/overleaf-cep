/**
 * LanguageTool settings component — rendered inside the Settings modal
 * (Editor → Spell check section) when the languagetoolSettings module import
 * is wired up in settings-modal-context.tsx.
 *
 * Persistence: language and enabled-flag are stored in localStorage per
 * project so collaborators can have independent preferences.
 *
 * Communication with the CodeMirror extension is done via a window
 * CustomEvent `lt:settings-changed` so this component does not need to be
 * inside the CodeMirrorViewContext.
 */

import { useState, useEffect, useCallback } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { getJSON } from '@/infrastructure/fetch-json'
import DropdownSetting from '@/features/settings/components/dropdown-setting'
import ToggleSetting from '@/features/settings/components/toggle-setting'

interface LTLanguage {
  name: string
  code: string
  longCode: string
}

interface LTStatus {
  enabled: boolean
}

export default function LanguageToolLanguageSetting() {
  const { projectId } = useProjectContext()

  const [ltAvailable, setLtAvailable] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState<boolean>(false)
  const [language, setLanguage] = useState<string>(() => {
    return localStorage.getItem(`lt-language-${projectId}`) || 'auto'
  })
  const [languages, setLanguages] = useState<LTLanguage[]>([])
  const [languagesLoading, setLanguagesLoading] = useState(false)

  // ── Check availability ─────────────────────────────────────────────────────
  useEffect(() => {
    getJSON<LTStatus>('/languagetool/status')
      .then(({ enabled: available }) => {
        setLtAvailable(available)
        if (available) {
          const storedEnabled =
            localStorage.getItem(`lt-enabled-${projectId}`) !== 'false'
          setEnabled(storedEnabled)
        }
      })
      .catch(() => setLtAvailable(false))
  }, [projectId])

  // ── Load language list when LT is available and toggle is on ───────────────
  useEffect(() => {
    if (!ltAvailable || !enabled || languages.length > 0) return

    setLanguagesLoading(true)
    getJSON<LTLanguage[]>('/languagetool/languages')
      .then(langs => {
        // Sort alphabetically by display name for usability
        const sorted = [...langs].sort((a, b) => a.name.localeCompare(b.name))
        setLanguages(sorted)
      })
      .catch(() => {})
      .finally(() => setLanguagesLoading(false))
  }, [ltAvailable, enabled, languages.length])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleToggle = useCallback(
    (newEnabled: boolean) => {
      setEnabled(newEnabled)
      localStorage.setItem(`lt-enabled-${projectId}`, String(newEnabled))
      window.dispatchEvent(
        new CustomEvent('lt:settings-changed', {
          detail: { enabled: newEnabled, language },
        })
      )
    },
    [projectId, language]
  )

  const handleLanguageChange = useCallback(
    (newLanguage: string) => {
      setLanguage(newLanguage)
      localStorage.setItem(`lt-language-${projectId}`, newLanguage)
      window.dispatchEvent(
        new CustomEvent('lt:settings-changed', {
          detail: { language: newLanguage, enabled },
        })
      )
    },
    [projectId, enabled]
  )

  // Don't render anything if LT is not configured on the server
  if (ltAvailable === null || ltAvailable === false) return null

  return (
    <>
      <ToggleSetting
        id="lt-enabled"
        label="LanguageTool grammar check"
        description="Enable grammar and style checking powered by LanguageTool"
        checked={enabled}
        onChange={handleToggle}
      />

      {enabled && (
        <DropdownSetting
          id="lt-language"
          label="LanguageTool language"
          options={[{ value: 'auto', label: 'Auto-detect' }]}
          optgroups={
            languages.length > 0
              ? [
                  {
                    label: 'Languages',
                    options: languages.map(l => ({
                      value: l.longCode,
                      label: l.name,
                    })),
                  },
                ]
              : []
          }
          onChange={handleLanguageChange}
          value={language}
          width="wide"
          loading={languagesLoading}
        />
      )}
    </>
  )
}
