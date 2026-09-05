import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  countWordsInFile,
  countWordsInLatexContent,
} from '@/features/word-count-modal/utils/count-words-in-file'
import {
  createEmptyWordCountData,
  WordCountData,
} from '@/features/word-count-modal/components/word-count-data'
import { createSegmenters } from '@/features/word-count-modal/utils/segmenters'
import { expect } from 'chai'
import { ProjectSnapshot } from '@/infrastructure/project-snapshot'
import { Snapshot } from 'overleaf-editor-core'

describe('word-count', function () {
  beforeEach(async function () {
    this.data = {
      encode: '',
      textWords: 0,
      headWords: 0,
      outside: 0,
      headers: 0,
      elements: 0,
      mathInline: 0,
      mathDisplay: 0,
      errors: 0,
      messages: '',
      textCharacters: 0,
      headCharacters: 0,
      captionWords: 0,
      captionCharacters: 0,
      footnoteWords: 0,
      footnoteCharacters: 0,
      abstractWords: 0,
      abstractCharacters: 0,
      otherWords: 0,
      otherCharacters: 0,
    } satisfies WordCountData

    const files = {
      'word-count.tex': {
        content: await readFile(
          path.join(__dirname, 'word-count.tex'),
          'utf-8'
        ),
      },
      'word-count-with-ignored-sections.tex': {
        content: await readFile(
          path.join(__dirname, 'word-count-with-ignored-sections.tex'),
          'utf-8'
        ),
      },
      'extra-words.tex': {
        content: await readFile(
          path.join(__dirname, 'extra-words.tex'),
          'utf-8'
        ),
      },
      'subfolder/extra-words.tex': {
        content: await readFile(
          path.join(__dirname, 'extra-words.tex'),
          'utf-8'
        ),
      },
    }

    const projectSnapshot = new ProjectSnapshot('test')
    // @ts-expect-error ignoring that "snapshot" is private
    projectSnapshot.snapshot = Snapshot.fromRaw({ files })
    this.projectSnapshot = projectSnapshot

    this.segmenters = createSegmenters('en_US')
  })

  it('produces correct counts', function () {
    countWordsInFile(
      this.data,
      this.projectSnapshot,
      'word-count.tex',
      '/',
      this.segmenters
    )

    expect(this.data).to.deep.include({
      abstractCharacters: 8,
      abstractWords: 2,
      captionCharacters: 16,
      captionWords: 4,
      footnoteCharacters: 8,
      footnoteWords: 2,
      headCharacters: 305,
      headWords: 53,
      otherCharacters: 10,
      otherWords: 2,
      textCharacters: 249,
      textWords: 56,
    })
  })

  it('skips ignored sections', function () {
    countWordsInFile(
      this.data,
      this.projectSnapshot,
      'word-count-with-ignored-sections.tex',
      '/',
      this.segmenters
    )

    expect(this.data).to.deep.include({
      abstractCharacters: 0,
      abstractWords: 0,
      captionCharacters: 0,
      captionWords: 0,
      footnoteCharacters: 0,
      footnoteWords: 0,
      headCharacters: 0,
      headWords: 0,
      otherCharacters: 0,
      otherWords: 0,
      textCharacters: 10,
      textWords: 3,
    })
  })
})

describe('selected-text word count', function () {
  const segmenters = createSegmenters('en-US')

  const countSelection = (
    content: string,
    from: number,
    to: number,
    localeSegmenters = segmenters
  ) => {
    const data = createEmptyWordCountData()
    countWordsInLatexContent(data, content, localeSegmenters, {
      range: { from, to },
    })
    return data
  }

  const countSelectedText = (content: string, selectedText: string) => {
    const from = content.indexOf(selectedText)
    expect(from).to.be.greaterThanOrEqual(0)
    return countSelection(content, from, from + selectedText.length)
  }

  it('counts plain prose', function () {
    const content = 'Hello world from Overleaf.'
    const data = countSelection(content, 0, content.length)

    expect(data.textWords).to.equal(4)
  })

  it('counts only a partial range', function () {
    const data = countSelectedText('one two three four', 'two three')

    expect(data.textWords).to.equal(2)
  })

  it('counts human-readable text inside formatting commands', function () {
    const data = countSelectedText(
      'This is \\textbf{important text}.',
      'important text'
    )

    expect(data.textWords).to.equal(2)
  })

  it('does not count a citation key selected inside a citation', function () {
    const data = countSelectedText(
      'According to \\cite{smith2026}, results improve.',
      'smith2026'
    )

    expect(data.textWords).to.equal(0)
  })

  it('counts prose in an optional citation argument', function () {
    const data = countSelectedText(
      'According to \\cite[see detailed discussion]{smith2026}.',
      'see detailed discussion'
    )

    expect(data.textWords).to.equal(3)
  })

  it('does not count selected math as prose', function () {
    const data = countSelectedText(
      'The result is $E = mc^2$ today.',
      'E = mc^2'
    )

    expect(data.textWords).to.equal(0)
    expect(data.mathInline).to.equal(1)
  })

  it('does not count selected comment text', function () {
    const data = countSelectedText(
      'Visible text. % hidden comment words\n',
      'hidden comment words'
    )

    expect(data.textWords).to.equal(0)
  })

  it('retains TeXcount ignore state from before the selection', function () {
    const data = countSelectedText(
      '%TC:ignore\nthese words are ignored\n%TC:endignore\nvisible',
      'these words are ignored'
    )

    expect(data.textWords).to.equal(0)
  })

  it('does not follow input files or count their paths', function () {
    const content = 'Before.\n\\input{chapter}\nAfter.'
    const data = countSelection(content, 0, content.length)

    expect(data.textWords).to.equal(2)
  })

  it('uses Unicode-aware segmentation for Vietnamese', function () {
    const content = 'Đây là một đoạn văn tiếng Việt.'
    const data = countSelection(
      content,
      0,
      content.length,
      createSegmenters('vi')
    )

    expect(data.textWords).to.equal(7)
  })

  it('counts a complete synthetic replacement as one atomic word', function () {
    const content = 'Made with \\LaTeX today.'
    const data = countSelectedText(content, '\\LaTeX')

    expect(data.textWords).to.equal(1)
  })

  it('does not count a partial synthetic replacement', function () {
    const content = 'Made with \\LaTeX today.'
    const data = countSelectedText(content, 'LaTeX')

    expect(data.textWords).to.equal(0)
  })

  it('clips out-of-bounds ranges to the document', function () {
    const content = 'one two'
    const data = countSelection(content, -100, 100)

    expect(data.textWords).to.equal(2)
  })

  it('returns zero for an empty range', function () {
    const data = countSelection('one two', 3, 3)

    expect(data.textWords).to.equal(0)
  })
})
