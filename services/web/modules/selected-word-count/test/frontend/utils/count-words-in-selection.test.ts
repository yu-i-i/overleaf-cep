import { expect } from 'chai'
import { createSegmenters } from '@/features/word-count-modal/utils/segmenters'
import { countWordsInSelection } from '../../../frontend/utils/count-words-in-selection'

describe('selected-text word count', function () {
  const segmenters = createSegmenters('en-US')

  const countSelectionResult = (
    content: string,
    from: number,
    to: number,
    localeSegmenters = segmenters
  ) => countWordsInSelection(content, { from, to }, localeSegmenters)

  const countSelection = (
    content: string,
    from: number,
    to: number,
    localeSegmenters = segmenters
  ) =>
    countSelectionResult(content, from, to, localeSegmenters).totalWords

  const countSelectedText = (content: string, selectedText: string) => {
    const from = content.indexOf(selectedText)
    expect(from).to.be.greaterThanOrEqual(0)
    return countSelection(content, from, from + selectedText.length)
  }

  it('counts plain prose', function () {
    const content = 'Hello world from Overleaf.'

    expect(countSelection(content, 0, content.length)).to.equal(4)
  })

  it('returns word, header, and math counts for a mixed selection', function () {
    const content =
      '\\section{Heading words}\n' +
      'Body text $x+y$ and \\[z=1\\]'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 5,
      headers: 1,
      mathInline: 1,
      mathDisplay: 1,
    })
  })

  it('does not count header or math nodes outside the selection', function () {
    const content =
      '\\section{Outside heading}\n' +
      'Selected words $x+y$'
    const selectedText = 'Selected words'
    const from = content.indexOf(selectedText)

    expect(
      countSelectionResult(content, from, from + selectedText.length)
    ).to.deep.equal({
      totalWords: 2,
      headers: 0,
      mathInline: 0,
      mathDisplay: 0,
    })
  })

  it('counts only a partial range', function () {
    expect(countSelectedText('one two three four', 'two three')).to.equal(2)
  })

  it('counts human-readable text inside formatting commands', function () {
    expect(
      countSelectedText(
        'This is \\textbf{important text}.',
        'important text'
      )
    ).to.equal(2)
  })

  it('does not count a citation key selected inside a citation', function () {
    expect(
      countSelectedText(
        'According to \\cite{smith2026}, results improve.',
        'smith2026'
      )
    ).to.equal(0)
  })

  it('counts prose in an optional citation argument', function () {
    expect(
      countSelectedText(
        'According to \\cite[see detailed discussion]{smith2026}.',
        'see detailed discussion'
      )
    ).to.equal(3)
  })

  it('does not count selected math as prose', function () {
    const content = 'The result is $E = mc^2$ today.'
    const selectedText = 'E = mc^2'
    const from = content.indexOf(selectedText)

    expect(
      countSelectionResult(content, from, from + selectedText.length)
    ).to.deep.equal({
      totalWords: 0,
      headers: 0,
      mathInline: 1,
      mathDisplay: 0,
    })
  })

  it('does not count selected comment text', function () {
    expect(
      countSelectedText(
        'Visible text. % hidden comment words\n',
        'hidden comment words'
      )
    ).to.equal(0)
  })

  it('retains TeXcount ignore state from before the selection', function () {
    expect(
      countSelectedText(
        '%TC:ignore\nthese words are ignored\n%TC:endignore\nvisible',
        'these words are ignored'
      )
    ).to.equal(0)
  })

  it('does not count structures inside a TeXcount ignore range', function () {
    const content =
      '%TC:ignore\n' +
      '\\section{Hidden heading}\n' +
      '$x+y$\n' +
      '\\[z=1\\]\n' +
      '%TC:endignore\n' +
      'visible'
    const selectedText =
      '\\section{Hidden heading}\n$x+y$\n\\[z=1\\]'
    const from = content.indexOf(selectedText)

    expect(
      countSelectionResult(content, from, from + selectedText.length)
    ).to.deep.equal({
      totalWords: 0,
      headers: 0,
      mathInline: 0,
      mathDisplay: 0,
    })
  })

  it('does not follow input files or count their paths', function () {
    const content = 'Before.\n\\input{chapter}\nAfter.'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('counts headings, captions, and footnotes as selected words', function () {
    const content =
      '\\section{Heading words}\n' +
      '\\begin{figure}\\caption{Caption words}\\end{figure}\n' +
      'Body\\footnote{Footnote words}'

    expect(countSelection(content, 0, content.length)).to.equal(7)
  })

  it('uses Unicode-aware segmentation for Vietnamese', function () {
    const content = 'Đây là một đoạn văn tiếng Việt.'

    expect(
      countSelection(content, 0, content.length, createSegmenters('vi'))
    ).to.equal(7)
  })

  it('counts a complete synthetic replacement as one atomic word', function () {
    expect(countSelectedText('Made with \\LaTeX today.', '\\LaTeX')).to.equal(1)
  })

  it('does not count a partial synthetic replacement', function () {
    expect(countSelectedText('Made with \\LaTeX today.', 'LaTeX')).to.equal(0)
  })

  it('clips out-of-bounds ranges to the document', function () {
    expect(countSelection('one two', -100, 100)).to.equal(2)
  })

  it('returns zero for an empty range', function () {
    expect(countSelection('one two', 3, 3)).to.equal(0)
    expect(countSelectionResult('one two', 3, 3)).to.deep.equal({
      totalWords: 0,
      headers: 0,
      mathInline: 0,
      mathDisplay: 0,
    })
  })
})
