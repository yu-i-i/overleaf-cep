import CodeMirrorEditor from '../../../../../frontend/js/features/source-editor/components/codemirror-editor'
import { EditorProviders } from '../../../../../test/frontend/helpers/editor-providers'
import { mockScope } from '../../../../../test/frontend/features/source-editor/helpers/mock-scope'
import { TestContainer } from '../../../../../test/frontend/features/source-editor/helpers/test-container'
import type { SelectedWordCountRequest } from '../../../frontend/selected-word-count-events'

describe('selected word count floating-menu actions', function () {
  const mountEditor = (migrationEnabled: boolean) => {
    window.metaAttributesCache.set('ol-preventCompileOnLoad', true)
    window.metaAttributesCache.set('ol-splitTestVariants', {
      'writefull-toolbar-migration': migrationEnabled ? 'enabled' : 'default',
    })

    cy.interceptEvents()

    cy.mount(
      <TestContainer>
        <EditorProviders
          scope={mockScope()}
          features={{ trackChangesVisible: true }}
          userSettings={{ floatingMenu: true }}
        >
          <CodeMirrorEditor />
        </EditorProviders>
      </TestContainer>
    )

    cy.findByText('contentLine 12').type(
      '{home}{shift}' + '{rightArrow}'.repeat(6),
      { scrollBehavior: false }
    )
  }

  const assertActionCapturesSelection = (menuSelector: string) => {
    let request: SelectedWordCountRequest | undefined

    cy.window().then(win => {
      win.addEventListener('selected-word-count:open', event => {
        request = (event as CustomEvent<SelectedWordCountRequest>).detail
      })
    })

    cy.get(menuSelector).within(() => {
      cy.findByRole('button', { name: 'Word Count' })
        .should('contain.text', 'Word Count')
        .click({ scrollBehavior: false })
    })

    cy.then(() => {
      expect(request).not.to.be.undefined
      if (!request) {
        return
      }

      expect(request.from).to.be.lessThan(request.to)
      expect(request.doc.sliceString(request.from, request.to)).to.have.length(6)
    })
  }

  it('renders in the unified floating menu and captures the selection', function () {
    mountEditor(true)

    cy.get('.review-tooltip-menu').should('not.exist')
    assertActionCapturesSelection('.editor-floating-menu')
  })

  it('renders in the legacy review tooltip and captures the selection', function () {
    mountEditor(false)

    cy.get('.editor-floating-menu').should('not.exist')
    assertActionCapturesSelection('.review-tooltip-menu')
  })
})
