import { Text } from '@codemirror/state'
import SelectedWordCountController from '../../../../modules/selected-word-count/frontend/components/selected-word-count-controller'
import { openSelectedWordCount } from '../../../../modules/selected-word-count/frontend/selected-word-count-events'
import { EditorProviders } from '../../helpers/editor-providers'

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
      cy.findByText('Word count — selected text').should('exist')
      cy.findByTestId('selected-word-count-total').should('have.text', '2')
      cy.findByRole('button', { name: 'Close' }).click()
    })

    cy.findByRole('dialog').should('not.exist')
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
