// Repro for React #137 ('got: input') when opening the BYO "Add provider" draft.
// DEV-mode render so the full error message + component stack are visible.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeAll, vi } from 'vitest'
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

describe('llm byo add-provider draft', () => {
  it('renders the draft without throwing React #137', async () => {
    process.env.NODE_ENV = 'development'
    const { default: LLMSettingsSection } =
      await import('../../../modules/llm/frontend/js/components/llm-settings-section')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(React.createElement(LLMSettingsSection))
    })

    const buttons = () =>
      [...container.querySelectorAll('button')].map((b) => (b.textContent || '').trim())
    const addBtn =
      [...container.querySelectorAll('button')].find((b) =>
        (b.textContent || '').includes('Add provider'),
      ) || null

    let clickErr
    if (addBtn) {
      await act(async () => {
        try {
          addBtn.click()
        }
        catch (e) {
          clickErr = e
        }
      })
      await act(async () => {})
    }

    console.log('BUTTONS BEFORE CLICK:', JSON.stringify(buttons()))
    console.log('BUTTONS AFTER CLICK:', JSON.stringify(buttons()))
    console.log('EDITOR PRESENT:', !!container.querySelector('.llm-buo-editor'))
    if (clickErr) console.log('CLICK ERROR:', clickErr)

    expect(clickErr).toBeUndefined()
    expect(!!container.querySelector('.llm-buo-editor')).toBe(true)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})

describe('llm byo test-connection notification', () => {
  it('renders the result text (regression: OLNotification props were variant/children -> empty info icon)', async () => {
    const { default: LLMSettingsSection } = await import(
      '../../../modules/llm/frontend/js/components/llm-settings-section'
    )

    const makeResponse = (status, payload) => {
      const body = JSON.stringify(payload)
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        url: '/x',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: async () => body,
        json: async () => payload,
      }
    }

    const run = async (mockFetch) => {
      vi.stubGlobal('fetch', mockFetch)
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => {
        root.render(React.createElement(LLMSettingsSection))
      })
      // open the "add provider" editor
      const addBtn = [...container.querySelectorAll('button')].find((b) =>
        (b.textContent || '').includes('Add provider'),
      )
      if (addBtn) {
        await act(async () => addBtn.click())
      }
      await act(async () => {})
      // fill required fields on the DRAFT
      const setVal = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        ).set
        setter.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const urlInput = container.querySelector('#llm-buo-url')
      const modelInput = container.querySelector('.llm-buo-model-editor input')
      if (urlInput) {
        await act(async () => setVal(urlInput, 'https://example.test/v1'))
      }
      if (modelInput) {
        await act(async () => setVal(modelInput, 'test-model'))
      }
      // click "Test connection"
      const testBtn = [...container.querySelectorAll('button')].find((b) =>
        (b.textContent || '').includes('Test connection'),
      )
      expect(testBtn).not.toBe(null)
      await act(async () => {
        testBtn.click()
      })
      await act(async () => {})
      const note = container.querySelector('.llm-buo-editor .notification')
      const content = container.querySelector('.llm-buo-editor .notification-content')
      const result = {
        noteClass: note ? note.className : null,
        text: content ? (content.textContent || '').trim() : null,
      }
      await act(async () => root.unmount())
      container.remove()
      return result
    }

    // error path (401 auth)
    const errResult = await run(async () =>
      makeResponse(401, {
        ok: false,
        error: 'auth',
        message: 'The provider rejected the API key (HTTP 401/403).',
      }),
    )
    console.log('ERROR PATH:', JSON.stringify(errResult))
    expect(errResult.noteClass).toContain('notification-type-error')
    expect(errResult.text).toContain('rejected the API key')

    // success path
    const okResult = await run(async () =>
      makeResponse(200, {
        ok: true,
        message: 'Connection successful',
        models: ['m1', 'm2'],
      }),
    )
    console.log('SUCCESS PATH:', JSON.stringify(okResult))
    expect(okResult.noteClass).toContain('notification-type-success')
    expect(okResult.text).toContain('Connection successful')
    vi.unstubAllGlobals()
  })
})
