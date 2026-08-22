// Regression: after F13 (inline styles -> scss classes) + F14 (fetch-utils),
// the admin settings page must still render fully with zero inline styles.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
})

describe('llm admin settings page render', () => {
  it('renders the full page without errors, wrapped in the scss root class', async () => {
    const { default: AdminPage } = await import(
      '../../../modules/llm/frontend/js/components/llm-admin-settings-page'
    )

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    renderErr = null
    await act(async () => {
      try {
        root.render(React.createElement(AdminPage))
      } catch (e) {
        renderErr = e
      }
    })
    await act(async () => {})

    expect(renderErr).toBe(null)
    const page = container.querySelector('.ol-llm-admin-settings')
    expect(page).not.toBeNull()
    // Save button present
    expect(
      [...container.querySelectorAll('button')].some(b =>
        /save/i.test(b.textContent || '')
      )
    ).toBe(true)
    // No inline style attributes on rendered elements
    const withStyle = [...container.querySelectorAll('[style]')]
    expect(withStyle.length).toBe(0)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
let renderErr = null
