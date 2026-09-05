import { expect } from 'chai'
import { createSegmenters } from '@/features/word-count-modal/utils/segmenters'
import { countWordsInSelection } from '../../../frontend/utils/count-words-in-selection'
import { createSentenceSegmenter } from '../../../frontend/utils/sentence-segmenter'

describe('selected-text word count', function () {
  const segmenters = createSegmenters('en-US')
  const sentenceSegmenter = createSentenceSegmenter('en-US')

  const countSelectionResult = (
    content: string,
    from: number,
    to: number,
    localeSegmenters = segmenters,
    localeSentenceSegmenter = sentenceSegmenter
  ) =>
    countWordsInSelection(
      content,
      { from, to },
      localeSegmenters,
      localeSentenceSegmenter
    )

  const countSelection = (
    content: string,
    from: number,
    to: number,
    localeSegmenters = segmenters
  ) => countSelectionResult(content, from, to, localeSegmenters).totalWords

  const countSelectedText = (content: string, selectedText: string) => {
    const from = content.indexOf(selectedText)
    expect(from).to.be.greaterThanOrEqual(0)
    return countSelection(content, from, from + selectedText.length)
  }

  it('counts plain prose', function () {
    const content = 'Hello world from Overleaf.'

    expect(countSelection(content, 0, content.length)).to.equal(4)
  })

  it('counts common sentence-ending punctuation', function () {
    const content = 'Hello world. This works! Is it ready?'

    expect(countSelectionResult(content, 0, content.length).sentences).to.equal(
      3
    )
  })

  it('counts a final sentence without ending punctuation', function () {
    const content = 'Hello world'

    expect(countSelectionResult(content, 0, content.length).sentences).to.equal(
      1
    )
  })

  it('does not count punctuation-only segments as sentences', function () {
    const content = '... ?!'

    expect(countSelectionResult(content, 0, content.length).sentences).to.equal(
      0
    )
  })

  it('handles decimal numbers and common abbreviations', function () {
    const content = 'Use e.g. version 3.14 today. It works.'

    expect(countSelectionResult(content, 0, content.length).sentences).to.equal(
      2
    )
  })

  it('counts sentences from visible text after filtering LaTeX', function () {
    const content =
      'First \\textbf{visible} sentence. % hidden sentence.\n' +
      'Second $x+y$ sentence!'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 5,
      sentences: 2,
      headers: 0,
      mathInline: 1,
      mathDisplay: 0,
    })
  })

  it('counts sentences only inside the selected range', function () {
    const content = 'First sentence. Second sentence! Third sentence?'
    const selectedText = 'Second sentence!'
    const from = content.indexOf(selectedText)

    expect(
      countSelectionResult(content, from, from + selectedText.length).sentences
    ).to.equal(1)
  })

  it('uses locale-aware sentence segmentation for English', function () {
    const content = 'This is sentence one. This is sentence two!'

    expect(
      countSelectionResult(
        content,
        0,
        content.length,
        createSegmenters('en-US'),
        createSentenceSegmenter('en-US')
      ).sentences
    ).to.equal(2)
  })

  it('falls back when the sentence locale is invalid', function () {
    const content = 'First sentence. Second sentence!'

    expect(
      countSelectionResult(
        content,
        0,
        content.length,
        segmenters,
        createSentenceSegmenter('invalid_locale')
      ).sentences
    ).to.equal(2)
  })

  it('returns word, header, and math counts for a mixed selection', function () {
    const content =
      '\\section{Heading words}\n' + 'Body text $x+y$ and \\[z=1\\]'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 5,
      sentences: 1,
      headers: 1,
      mathInline: 1,
      mathDisplay: 1,
    })
  })

  it('does not count header or math nodes outside the selection', function () {
    const content = '\\section{Outside heading}\n' + 'Selected words $x+y$'
    const selectedText = 'Selected words'
    const from = content.indexOf(selectedText)

    expect(
      countSelectionResult(content, from, from + selectedText.length)
    ).to.deep.equal({
      totalWords: 2,
      sentences: 1,
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
      countSelectedText('This is \\textbf{important text}.', 'important text')
    ).to.equal(2)
  })

  it('joins word fragments separated only by formatting markup', function () {
    const content = 'inter\\textbf{nal}formatting'

    expect(countSelection(content, 0, content.length)).to.equal(1)
  })

  it('joins fragments across adjacent formatting commands', function () {
    const content = 'inter\\textbf{n}\\emph{al}formatting'

    expect(countSelection(content, 0, content.length)).to.equal(1)
  })

  it('keeps real whitespace around formatting as a word boundary', function () {
    const content = 'one \\textbf{two}'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('keeps excluded math inside formatting as a word boundary', function () {
    const content = 'before\\textbf{$x$}after'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 2,
      sentences: 1,
      headers: 0,
      mathInline: 1,
      mathDisplay: 0,
    })
  })

  it('keeps an excluded citation inside formatting as a boundary', function () {
    const content = 'before\\textbf{\\cite{key}}after'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 2,
      sentences: 1,
      headers: 0,
      mathInline: 0,
      mathDisplay: 0,
    })
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
      sentences: 0,
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

  it('counts rendered text inside TeXcount ignore directives', function () {
    expect(
      countSelectedText(
        '%TC:ignore\nthese words are ignored\n%TC:endignore\nvisible',
        'these words are ignored'
      )
    ).to.equal(4)
  })

  it('counts rendered structures inside TeXcount ignore directives', function () {
    const content =
      '%TC:ignore\n' +
      '\\section{Visible heading}\n' +
      '$x+y$\n' +
      '\\[z=1\\]\n' +
      '%TC:endignore\n' +
      'visible'
    const selectedText = '\\section{Visible heading}\n$x+y$\n\\[z=1\\]'
    const from = content.indexOf(selectedText)

    expect(
      countSelectionResult(content, from, from + selectedText.length)
    ).to.deep.equal({
      totalWords: 2,
      sentences: 1,
      headers: 1,
      mathInline: 1,
      mathDisplay: 1,
    })
  })

  it('collapses comments in the same way as LaTeX', function () {
    const content = 'inter% comment removes the newline\nnational'

    expect(countSelection(content, 0, content.length)).to.equal(1)
  })

  it('does not follow input or include files or count their paths', function () {
    const content =
      'Before.\n\\input{chapter}\nMiddle.\n\\include{appendix}\nAfter.'

    expect(countSelection(content, 0, content.length)).to.equal(3)
  })

  it('counts title, author, affiliation, and date rendered by maketitle', function () {
    const content =
      '\\title{Visible Title}\n' +
      '\\author{Alice Smith}\n' +
      '\\affil{Example University}\n' +
      '\\date{June 2026}\n' +
      '\\begin{document}\\maketitle\\end{document}'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 8,
      sentences: 1,
      headers: 1,
      mathInline: 0,
      mathDisplay: 0,
    })
  })

  it('does not count title metadata when maketitle is absent', function () {
    const content =
      '\\title{Hidden Title}\\author{Hidden Author}\\begin{document}Body\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(1)
  })

  it('counts IEEE author block contents rendered by maketitle', function () {
    const content =
      '\\begin{document}' +
      '\\author{\\IEEEauthorblockN{Alice Smith}\\IEEEauthorblockA{Example University}}' +
      '\\maketitle\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(4)
  })

  it('does not count layout dimensions or drawing parameters', function () {
    const content = 'Before \\vspace{12pt} \\hspace{2em} \\cline{2-4} after.'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('does not count phantom text', function () {
    const content = 'Before \\phantom{hidden words} after.'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('counts visible href labels but not target URLs', function () {
    const content = '\\href{https://example.test/internal-path}{Visible link}'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('counts URLs that are rendered by the url command', function () {
    const content = '\\url{visible-address}'

    expect(countSelection(content, 0, content.length)).to.equal(1)
  })

  it('counts literal contents of verb and lstinline commands', function () {
    const content = 'Use \\verb|visible code| and \\lstinline!more code! here.'

    expect(countSelection(content, 0, content.length)).to.equal(7)
  })

  it('counts visible verbatim environment content', function () {
    const content =
      'Before \\begin{verbatim}literal code words\\end{verbatim} after.'

    expect(countSelection(content, 0, content.length)).to.equal(5)
  })

  it('does not count content in non-rendering environments', function () {
    const content = 'Before \\begin{comment}hidden words\\end{comment} after.'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('counts text-producing commands inside math', function () {
    const content =
      'Before $x + \\text{visible words} + \\textrm{more text}$ after.'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 6,
      sentences: 1,
      headers: 0,
      mathInline: 1,
      mathDisplay: 0,
    })
  })

  it('counts supported plain-text commands inside math', function () {
    const content = 'Before $\\mathrm{unit} + \\textnormal{normal text}$ after.'

    expect(countSelectionResult(content, 0, content.length)).to.deep.equal({
      totalWords: 5,
      sentences: 1,
      headers: 0,
      mathInline: 1,
      mathDisplay: 0,
    })
  })

  it('counts built-in text-producing macros', function () {
    const content = 'Made with \\TeX, \\LaTeX, and \\BibTeX.'

    expect(countSelection(content, 0, content.length)).to.equal(6)
  })

  it('expands simple zero-argument text macros after their definition', function () {
    const content =
      '\\newcommand{\\project}{Visible Project Name}' +
      '\\begin{document}The \\project works.\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(5)
  })

  it('expands simple def macros after their definition', function () {
    const content =
      '\\def\\project{Visible Project}' +
      '\\begin{document}The \\project works.\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(4)
  })

  it('uses the latest simple renewcommand definition', function () {
    const content =
      '\\newcommand{\\project}{First Name}' +
      '\\renewcommand{\\project}{Second Name}' +
      '\\begin{document}\\project\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('skips parameterized custom macros conservatively', function () {
    const content =
      '\\newcommand{\\greet}[1]{Hello #1}' +
      '\\begin{document}Before \\greet{World} after.\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('does not count macro definitions as rendered text', function () {
    const content =
      '\\newcommand{\\project}{Definition words}' +
      '\\begin{document}Visible body\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(2)
  })

  it('keeps table and bibliography prose in the word count', function () {
    const content =
      '\\begin{table}\\begin{tabular}{c}Visible table cell\\end{tabular}\\end{table}' +
      '\\begin{thebibliography}{1}\\bibitem{key}Visible reference words\\end{thebibliography}'

    expect(countSelection(content, 0, content.length)).to.equal(6)
  })

  it('counts optional item labels because they are rendered', function () {
    const content =
      '\\begin{description}\\item[Visible label]Body text\\end{description}'

    expect(countSelection(content, 0, content.length)).to.equal(4)
  })

  it('keeps formatted ordinal fragments joined inside IEEE author blocks', function () {
    const content =
      '\\begin{document}' +
      '\\author{' +
      '\\IEEEauthorblockN{1\\textsuperscript{st} Author}\\and' +
      '\\IEEEauthorblockN{2\\textsuperscript{nd} Author}}' +
      '\\maketitle\\end{document}'

    expect(countSelection(content, 0, content.length)).to.equal(4)
  })

  it('counts headings, captions, and footnotes as selected words', function () {
    const content =
      '\\section{Heading words}\n' +
      '\\begin{figure}\\caption{Caption words}\\end{figure}\n' +
      'Body\\footnote{Footnote words}'

    expect(countSelection(content, 0, content.length)).to.equal(7)
  })

  it('uses Unicode-aware segmentation for English text', function () {
    const content = 'The café résumé is ready.'

    expect(
      countSelection(content, 0, content.length, createSegmenters('en-US'))
    ).to.equal(5)
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
      sentences: 0,
      headers: 0,
      mathInline: 0,
      mathDisplay: 0,
    })
  })
})
