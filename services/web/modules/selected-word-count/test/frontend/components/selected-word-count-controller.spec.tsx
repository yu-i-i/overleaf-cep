import { Text } from '@codemirror/state'
import { EditorProviders } from '../../../../../test/frontend/helpers/editor-providers'
import SelectedWordCountController from '../../../frontend/components/selected-word-count-controller'
import { openSelectedWordCount } from '../../../frontend/selected-word-count-events'

describe('<SelectedWordCountController />', function () {
  it('counts the immutable document snapshot and closes the modal', function () {
    const content = 'one two three four'
    const from = content.indexOf('two three')
    const doc = Text.of([content])

    cy.mount(
      <EditorProviders>
        <SelectedWordCountController />
      </EditorProviders>
    )

    cy.then(() => {
      openSelectedWordCount({
        doc,
        from,
        to: from + 'two three'.length,
      })
    })

    cy.findByRole('dialog').within(() => {
      cy.findByText('Word Count').should('exist')
      cy.findByText('Total Words').should('exist')
      cy.findByTestId('selected-word-count-total').should('have.text', '2')
      cy.findByRole('button', { name: 'Close' }).click()
    })

    cy.findByRole('dialog').should('not.exist')
  })

  it('shows zero when the selection has no countable prose', function () {
    const content = '\\cite{smith2026}'
    const doc = Text.of([content])

    cy.mount(
      <EditorProviders>
        <SelectedWordCountController />
      </EditorProviders>
    )

    cy.then(() => {
      openSelectedWordCount({
        doc,
        from: 0,
        to: content.length,
      })
    })

    cy.findByTestId('selected-word-count-total').should('have.text', '0')
  })

  it('does not open for an empty range', function () {
    cy.mount(
      <EditorProviders>
        <SelectedWordCountController />
      </EditorProviders>
    )

    cy.then(() => {
      openSelectedWordCount({ doc: Text.of(['one']), from: 1, to: 1 })
    })

    cy.findByRole('dialog').should('not.exist')
  })
})
