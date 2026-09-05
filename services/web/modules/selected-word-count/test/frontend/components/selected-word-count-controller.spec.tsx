import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, type FC, type PropsWithChildren } from 'react'
import { useFileTreeOpenContext } from '@/features/ide-react/context/file-tree-open-context'
import type { FileTreeDocumentFindResult } from '@/features/ide-react/types/file-tree'
import {
  EditorProviders,
  makeEditorPropertiesProvider,
} from '../../../../../test/frontend/helpers/editor-providers'
import { EditorViewContext } from '../../../../../frontend/js/features/ide-react/context/editor-view-context'
import SelectedWordCountController from '../../../frontend/components/selected-word-count-controller'
import { WORD_COUNT_OPEN_REQUESTED_EVENT } from '../../../frontend/selected-word-count-events'

const ActiveDocument = () => {
  const { handleFileTreeSelect } = useFileTreeOpenContext()

  useEffect(() => {
    const document: FileTreeDocumentFindResult = {
      type: 'doc',
      entity: { _id: 'test-doc', name: 'main.tex' },
      parent: [],
      parentFolderId: 'root-folder-id',
      path: ['main.tex'],
      index: 0,
    }

    handleFileTreeSelect([document])
  }, [handleFileTreeSelect])

  return null
}

describe('<SelectedWordCountController />', function () {
  let view: EditorView | undefined

  const mountController = (
    content: string,
    from: number,
    to: number,
    options: { activeDocument?: boolean; showVisual?: boolean } = {}
  ) => {
    view = new EditorView({
      state: EditorState.create({
        doc: content,
        selection: { anchor: from, head: to },
      }),
    })

    const TestEditorViewProvider: FC<PropsWithChildren> = ({ children }) => (
      <EditorViewContext.Provider
        value={{ view: view ?? null, setView: () => undefined }}
      >
        {children}
      </EditorViewContext.Provider>
    )

    cy.mount(
      <EditorProviders
        providers={{
          EditorViewProvider: TestEditorViewProvider,
          EditorPropertiesProvider: makeEditorPropertiesProvider({
            showVisual: options.showVisual,
          }),
        }}
      >
        {options.activeDocument !== false && <ActiveDocument />}
        <SelectedWordCountController />
      </EditorProviders>
    )
  }

  const requestWordCount = () => {
    const event = new Event(WORD_COUNT_OPEN_REQUESTED_EVENT, {
      cancelable: true,
    })
    window.dispatchEvent(event)
    return event
  }

  afterEach(function () {
    view?.destroy()
    view = undefined
  })

  it('counts the immutable selection snapshot and closes the modal', function () {
    const content = 'one two three four'
    const from = content.indexOf('two three')
    mountController(content, from, from + 'two three'.length)

    cy.then(() => {
      const event = requestWordCount()
      expect(event.defaultPrevented).to.be.true

      view?.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: 'changed after opening',
        },
      })
    })

    cy.findByRole('dialog').within(() => {
      cy.findByText('Selected text word count').should('exist')
      cy.findByText('Total Words').should('exist')
      cy.findByText('Sentences').should('exist')
      cy.findByText('Headers').should('exist')
      cy.findByText('Math Inline').should('exist')
      cy.findByText('Math Display').should('exist')
      cy.findByTestId('selected-word-count-total').should('have.text', '2')
      cy.findByTestId('selected-word-count-sentences').should('have.text', '1')
      cy.findByTestId('selected-word-count-headers').should('have.text', '0')
      cy.findByTestId('selected-word-count-math-inline').should(
        'have.text',
        '0'
      )
      cy.findByTestId('selected-word-count-math-display').should(
        'have.text',
        '0'
      )
      cy.findByRole('button', { name: 'Close' }).click()
    })

    cy.findByRole('dialog').should('not.exist')
  })

  it('shows the selected header and math breakdown', function () {
    const content =
      '\\section{Heading words}\n' + 'Body text $x+y$ and \\[z=1\\]'
    mountController(content, 0, content.length)

    cy.then(() => {
      expect(requestWordCount().defaultPrevented).to.be.true
    })

    cy.findByRole('dialog').within(() => {
      cy.findByTestId('selected-word-count-total').should('have.text', '5')
      cy.findByTestId('selected-word-count-sentences').should('have.text', '1')
      cy.findByTestId('selected-word-count-headers').should('have.text', '1')
      cy.findByTestId('selected-word-count-math-inline').should(
        'have.text',
        '1'
      )
      cy.findByTestId('selected-word-count-math-display').should(
        'have.text',
        '1'
      )
    })
  })

  it('shows zero when the selection has no countable prose', function () {
    const content = '\\cite{smith2026}'
    mountController(content, 0, content.length)

    cy.then(() => {
      expect(requestWordCount().defaultPrevented).to.be.true
    })

    cy.findByTestId('selected-word-count-total').should('have.text', '0')
    cy.findByTestId('selected-word-count-sentences').should('have.text', '0')
  })

  it('does not handle the request when the selection is empty', function () {
    mountController('one', 1, 1)

    cy.then(() => {
      expect(requestWordCount().defaultPrevented).to.be.false
    })

    cy.findByRole('dialog').should('not.exist')
  })

  it('does not handle a selection when no document is active', function () {
    mountController('one two', 0, 3, { activeDocument: false })

    cy.then(() => {
      expect(requestWordCount().defaultPrevented).to.be.false
    })

    cy.findByRole('dialog').should('not.exist')
  })

  it('does not handle a source selection while the visual editor is active', function () {
    mountController('one two', 0, 3, { showVisual: true })

    cy.then(() => {
      expect(requestWordCount().defaultPrevented).to.be.false
    })

    cy.findByRole('dialog').should('not.exist')
  })
})
