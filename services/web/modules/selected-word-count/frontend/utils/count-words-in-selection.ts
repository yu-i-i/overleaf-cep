import { NodeType, type SyntaxNodeRef } from '@lezer/common'
import { LaTeXLanguage } from '@/features/source-editor/languages/latex/latex-language'
import { findPreambleExtent } from '@/features/word-count-modal/utils/find-preamble-extent'
import type { Segmenters } from '@/features/word-count-modal/utils/segmenters'
import type { SentenceSegmenter } from './sentence-segmenter'

type SourceRange = {
  from: number
  to: number
}

type TextNode = SourceRange & {
  text: string
}

type SimpleMacroDefinition = {
  from: number
  text: string
}

export type SelectedWordCountResult = {
  totalWords: number
  sentences: number
  headers: number
  mathInline: number
  mathDisplay: number
}

const mergeRanges = (ranges: SourceRange[]): SourceRange[] => {
  const merged: SourceRange[] = []
  const sorted = [...ranges].sort(
    (left, right) => left.from - right.from || left.to - right.to
  )

  for (const span of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && span.from <= previous.to) {
      previous.to = Math.max(previous.to, span.to)
    } else {
      merged.push({ ...span })
    }
  }

  return merged
}

const replacementsMap = new Map<string, string>([
  ['aa', 'å'],
  ['AA', 'Å'],
  ['ae', 'æ'],
  ['AE', 'Æ'],
  ['oe', 'œ'],
  ['OE', 'Œ'],
  ['o', 'ø'],
  ['O', 'Ø'],
  ['ss', 'ß'],
  ['SS', 'SS'],
  ['l', 'ł'],
  ['L', 'Ł'],
  ['dh', 'ð'],
  ['DH', 'Ð'],
  ['dj', 'đ'],
  ['DJ', 'Ð'],
  ['th', 'þ'],
  ['TH', 'Þ'],
  ['ng', 'ŋ'],
  ['NG', 'Ŋ'],
  ['i', 'ı'],
  ['j', 'ȷ'],
  ['&', '&'],
  ['$', '$'],
  ['%', '%'],
  ['#', '#'],
  ['_', '_'],
  ['{', '{'],
  ['}', '}'],
  ['H', 'ő'],
  ['b', 'o'],
  ['c', 'ç'],
  ['d', 'o'],
  ['k', 'ą'],
  ['r', 'å'],
  ['t', 'o͡o'],
  ['u', 'ŏ'],
  ['v', 'š'],
  ["'", ''],
  ['^', ''],
  ['"', ''],
  ['=', ''],
  ['.', ''],
  ['`', ''],
  ['~', ''],
  ['TeX', 'TeX'],
  ['LaTeX', 'LaTeX'],
  ['BibTeX', 'BibTeX'],
  ['textbackslash', '\\'],
])

const hiddenContentCommands = new Set(['phantom', 'hphantom', 'vphantom'])

const nonRenderingCommands = new Set([
  'addtocounter',
  'addtolength',
  'bibliography',
  'bibliographystyle',
  'cline',
  'color',
  'hspace',
  'includegraphics',
  'includesvg',
  'label',
  'pagestyle',
  'rule',
  'setcounter',
  'setlength',
  'thispagestyle',
  'vspace',
])

const transparentTextCommands = new Set([
  'MakeLowercase',
  'MakeUppercase',
  'fbox',
  'lowercase',
  'mbox',
  'uppercase',
])

const boundaryTextCommands = new Set([
  'IEEEauthorblockA',
  'IEEEauthorblockN',
  'centerline',
])

const nonRenderingEnvironments = new Set([
  'comment',
  'filecontents',
  'filecontents*',
])

const verbatimEnvironments = new Set([
  'Verbatim',
  'boxedverbatim',
  'codeexample',
  'lstlisting',
  'minted',
  'tcblisting',
  'verbatim',
])

const plainMathTextCommands = new Set(['mbox', 'mathrm', 'textnormal'])

const isSimpleMacroText = (text: string) =>
  text.length > 0 && !/[\\{}#$%&_~^]/u.test(text)

export const countWordsInSelection = (
  content: string,
  sourceRange: SourceRange,
  segmenters: Segmenters,
  sentenceSegmenter: SentenceSegmenter
): SelectedWordCountResult => {
  const result: SelectedWordCountResult = {
    totalWords: 0,
    sentences: 0,
    headers: 0,
    mathInline: 0,
    mathDisplay: 0,
  }

  const range = {
    from: Math.max(0, Math.min(sourceRange.from, content.length)),
    to: Math.max(0, Math.min(sourceRange.to, content.length)),
  }

  if (range.from >= range.to) {
    return result
  }

  const tree = LaTeXLanguage.parser.parse(content)
  const textNodes: TextNode[] = []
  const transparentRanges: SourceRange[] = []
  const collapsedRanges: SourceRange[] = []
  const boundaryRanges: SourceRange[] = []
  const boundaryPositions: number[] = []
  const maketitlePositions: number[] = []
  const simpleMacroDefinitions = new Map<string, SimpleMacroDefinition[]>()

  const addSimpleMacroDefinition = (
    name: string,
    definition: SimpleMacroDefinition
  ) => {
    const definitions = simpleMacroDefinitions.get(name) ?? []
    definitions.push(definition)
    simpleMacroDefinitions.set(name, definitions)
  }

  tree.iterate({
    enter(nodeRef: SyntaxNodeRef) {
      if (nodeRef.type.is('Maketitle')) {
        maketitlePositions.push(nodeRef.from)
        return false
      }

      const isNewCommand =
        nodeRef.type.is('NewCommand') || nodeRef.type.is('RenewCommand')
      const isDef = nodeRef.type.is('Def')
      if (!isNewCommand && !isDef) {
        return
      }

      if (
        (isNewCommand &&
          nodeRef.node.getChildren('OptionalArgument').length > 0) ||
        (isDef && nodeRef.node.getChildren('MacroParameter').length > 0)
      ) {
        return false
      }

      const nameNode =
        nodeRef.node.getChild('Csname') ??
        nodeRef.node.getChild('LiteralArgContent')
      const definitionNode = nodeRef.node.getChild('DefinitionArgument')
      if (!nameNode || !definitionNode) {
        return false
      }

      const nameMatch = /\\([A-Za-z@]+)/u.exec(
        content.substring(nameNode.from, nameNode.to)
      )
      const definitionText = content.substring(
        definitionNode.from + 1,
        definitionNode.to - 1
      )

      if (nameMatch && isSimpleMacroText(definitionText)) {
        addSimpleMacroDefinition(nameMatch[1], {
          from: nodeRef.to,
          text: definitionText,
        })
      }

      return false
    },
  })

  const preambleExtent = findPreambleExtent(tree)

  const intersectsRange = (span: SourceRange) =>
    span.to > range.from && span.from < range.to

  const rangesOverlap = (left: SourceRange, right: SourceRange) =>
    left.to > right.from && left.from < right.to

  const isContainedInRange = (span: SourceRange) =>
    span.from >= range.from && span.to <= range.to

  const addBoundaryRange = (span: SourceRange) => {
    if (intersectsRange(span)) {
      boundaryRanges.push({ from: span.from, to: span.to })
    }
  }

  const addBoundaryPositions = (span: SourceRange) => {
    if (intersectsRange(span)) {
      boundaryPositions.push(span.from, span.to)
    }
  }

  const addTransparentRange = (span: SourceRange) => {
    if (intersectsRange(span)) {
      transparentRanges.push({ from: span.from, to: span.to })
    }
  }

  const addCollapsedRange = (span: SourceRange) => {
    if (intersectsRange(span)) {
      collapsedRanges.push({ from: span.from, to: span.to })
    }
  }

  const addSourceTextSpan = (span: SourceRange) => {
    if (!intersectsRange(span)) {
      return
    }

    const from = Math.max(span.from, range.from)
    const to = Math.min(span.to, range.to)

    textNodes.push({
      from,
      to,
      text: content.substring(from, to),
    })
  }

  const addSourceTextNode = (nodeRef: SyntaxNodeRef) => {
    addSourceTextSpan(nodeRef)
  }

  const addSyntheticTextNode = (
    sourceSpan: SourceRange,
    text: string,
    textNodeSpan: SourceRange = sourceSpan
  ) => {
    if (!isContainedInRange(sourceSpan)) {
      return
    }

    textNodes.push({
      from: textNodeSpan.from,
      to: textNodeSpan.to,
      text,
    })
  }

  const findSimpleMacroReplacement = (name: string, position: number) => {
    const definitions = simpleMacroDefinitions.get(name)
    if (!definitions) {
      return
    }

    let replacement: string | undefined
    for (const definition of definitions) {
      if (definition.from > position) {
        break
      }
      replacement = definition.text
    }
    return replacement
  }

  const visitBodyNode = (nodeRef: SyntaxNodeRef): boolean | void => {
    return bodyMatcher(nodeRef.type)?.(nodeRef)
  }

  const iterateNode = (nodeRef: SyntaxNodeRef) => {
    nodeRef.node.cursor().iterate(childNodeRef => {
      if (childNodeRef.node !== nodeRef.node) {
        return visitBodyNode(childNodeRef)
      }
    })
  }

  const handleComment = (nodeRef: SyntaxNodeRef) => {
    addTransparentRange(nodeRef)
    addCollapsedRange(nodeRef)
  }

  const addDelimitedLiteralContent = (nodeRef: SourceRange) => {
    let from = nodeRef.from
    let to = nodeRef.to

    if (content[from] === '*') {
      from++
    }

    if (to - from >= 2) {
      from++
      to--
    }

    if (from < to) {
      addSourceTextSpan({ from, to })
    }
  }

  const isRenderedByMaketitle = (nodeRef: SyntaxNodeRef) =>
    maketitlePositions.some(position => position >= nodeRef.to)

  const handleMaketitleText = (
    nodeRef: SyntaxNodeRef,
    countAsHeader = false
  ) => {
    if (!isRenderedByMaketitle(nodeRef)) {
      return false
    }

    if (countAsHeader && intersectsRange(nodeRef)) {
      result.headers++
    }

    if (nodeRef.type.is('Date')) {
      const dateArgument = nodeRef.node.getChild('ShortTextArgument')
      if (dateArgument) {
        iterateNode(dateArgument)
      }
      return false
    }

    iterateNode(nodeRef)
    return false
  }

  const handleMathText = (nodeRef: SyntaxNodeRef) => {
    nodeRef.node.cursor().iterate(childNodeRef => {
      if (childNodeRef.node === nodeRef.node) {
        return
      }

      if (childNodeRef.type.is('MathTextCommand')) {
        const textArgument = childNodeRef.node.getChild('TextArgument')
        if (textArgument) {
          iterateNode(textArgument)
        }
        return false
      }

      if (childNodeRef.type.is('MathUnknownCommand')) {
        const macro = childNodeRef.node.getChild('$CtrlSeq')
        const argument = childNodeRef.node.getChild('MathArgument')
        if (!macro || !argument) {
          return false
        }

        const commandName = content.substring(macro.from + 1, macro.to)
        const argumentText = content.substring(
          argument.from + 1,
          argument.to - 1
        )
        if (
          plainMathTextCommands.has(commandName) &&
          isSimpleMacroText(argumentText)
        ) {
          addSourceTextSpan({ from: argument.from + 1, to: argument.to - 1 })
        }
        return false
      }
    })
  }

  const handleEnvironment = (nodeRef: SyntaxNodeRef) => {
    const envNameGroup = nodeRef.node
      .getChild('BeginEnv')
      ?.getChild('EnvNameGroup')

    if (!envNameGroup) {
      return
    }

    const envName = content
      .substring(envNameGroup.from + 1, envNameGroup.to - 1)
      .replace(/\*$/, '')

    if (nonRenderingEnvironments.has(envName)) {
      addBoundaryRange(nodeRef)
      return false
    }

    if (verbatimEnvironments.has(envName)) {
      const verbatimContent = nodeRef.node
        .getChild('Content')
        ?.getChild('VerbatimContent')
      if (verbatimContent) {
        addSourceTextSpan(verbatimContent)
      }
      return false
    }

    if (envName !== 'abstract') {
      return
    }

    if (intersectsRange(nodeRef)) {
      result.headers++
    }

    const contentNode = nodeRef.node.getChild('Content')
    if (contentNode) {
      iterateNode(contentNode)
    }

    return false
  }

  const headMatcher = NodeType.match<
    (nodeRef: SyntaxNodeRef) => boolean | void
  >({
    Comment(nodeRef) {
      handleComment(nodeRef)
      return false
    },
    Title(nodeRef) {
      return handleMaketitleText(nodeRef, true)
    },
    'Author Affil Affiliation Date'(nodeRef) {
      return handleMaketitleText(nodeRef)
    },
    $Environment(nodeRef) {
      return handleEnvironment(nodeRef)
    },
  })

  const bodyMatcher = NodeType.match<
    (nodeRef: SyntaxNodeRef) => boolean | void
  >({
    Comment(nodeRef) {
      handleComment(nodeRef)
      return false
    },
    Normal(nodeRef) {
      addSourceTextNode(nodeRef)
    },
    Cite(nodeRef) {
      addBoundaryRange(nodeRef)
      const optionalArgs = nodeRef.node.getChildren('OptionalArgument')
      for (const arg of optionalArgs) {
        const child = arg.getChild('ShortOptionalArg')
        if (child) {
          iterateNode(child)
        }
      }
      return false
    },
    UnknownCommand(nodeRef) {
      const macro =
        nodeRef.node.getChild('$CtrlSeq') ?? nodeRef.node.getChild('$CtrlSym')
      if (!macro) {
        return
      }

      const commandName = content.substring(macro.from + 1, macro.to)
      if (!commandName) {
        return
      }

      if (commandName === 'thanks') {
        iterateNode(nodeRef)
        return false
      }

      if (
        hiddenContentCommands.has(commandName) ||
        nonRenderingCommands.has(commandName)
      ) {
        addBoundaryRange(nodeRef)
        return false
      }

      if (boundaryTextCommands.has(commandName)) {
        addBoundaryPositions(nodeRef)
        return
      }

      if (transparentTextCommands.has(commandName)) {
        addTransparentRange(nodeRef)
        return
      }

      const simpleMacroReplacement = findSimpleMacroReplacement(
        commandName,
        macro.from
      )
      if (simpleMacroReplacement !== undefined) {
        addSyntheticTextNode(macro, simpleMacroReplacement)
        return false
      }

      const replacement = replacementsMap.get(commandName)
      if (replacement === undefined) {
        addBoundaryRange(nodeRef)
        return false
      }

      const commandTail = content.substring(macro.to, nodeRef.to)
      addSyntheticTextNode(
        macro,
        replacement,
        commandTail.trim() === '' ? macro : nodeRef
      )
      return false
    },
    $Environment(nodeRef) {
      return handleEnvironment(nodeRef)
    },
    'Title Author Affil Affiliation Date'(nodeRef) {
      if (nodeRef.to <= preambleExtent.to) {
        return false
      }
      return handleMaketitleText(nodeRef, nodeRef.type.is('Title'))
    },
    '$ToggleTextFormattingCommand $OtherTextFormattingCommand'(nodeRef) {
      addTransparentRange(nodeRef)
    },
    HrefCommand(nodeRef) {
      const label = nodeRef.node.getChild('ShortTextArgument')
      if (label) {
        iterateNode(label)
      }
      return false
    },
    UrlCommand(nodeRef) {
      const literalContent = nodeRef.node
        .getChild('UrlArgument')
        ?.getChild('LiteralArgContent')
      if (literalContent) {
        addSourceTextSpan(literalContent)
      }
      return false
    },
    'VerbCommand LstInlineCommand'(nodeRef) {
      const literalContent =
        nodeRef.node.getChild('VerbContent') ??
        nodeRef.node.getChild('LstInlineContent')
      if (literalContent) {
        addDelimitedLiteralContent(literalContent)
      }
      return false
    },
    Item(nodeRef) {
      for (const optionalArgument of nodeRef.node.getChildren(
        'OptionalArgument'
      )) {
        const label = optionalArgument.getChild('ShortOptionalArg')
        if (label) {
          iterateNode(label)
        }
      }
      return false
    },
    'Def Let NewCommand RenewCommand NewEnvironment RenewEnvironment NewTheoremCommand TheoremStyleCommand'() {
      return false
    },
    'IncludeGraphics IncludeSvg SetLengthCommand'(nodeRef) {
      addBoundaryRange(nodeRef)
      return false
    },
    BeginEnv() {
      return false
    },
    Math(nodeRef) {
      if (!intersectsRange(nodeRef)) {
        return false
      }

      addBoundaryRange(nodeRef)
      handleMathText(nodeRef)

      const parent = nodeRef.node.parent
      if (parent?.type.is('InlineMath') || parent?.type.is('ParenMath')) {
        result.mathInline++
      } else {
        result.mathDisplay++
      }

      return false
    },
    'ShortTextArgument ShortOptionalArg'(nodeRef) {
      addBoundaryRange(nodeRef)
      return false
    },
    SectioningArgument(nodeRef) {
      if (intersectsRange(nodeRef)) {
        result.headers++
      }
      iterateNode(nodeRef)
      return false
    },
    Caption(nodeRef) {
      iterateNode(nodeRef)
      return false
    },
    'FootnoteCommand EndnoteCommand'(nodeRef) {
      iterateNode(nodeRef)
      return false
    },
    'IncludeArgument InputArgument SubfileArgument'(nodeRef) {
      addBoundaryRange(nodeRef)
      return false
    },
    'BlankLine LineBreak'(nodeRef) {
      addSyntheticTextNode(nodeRef, '\n')
    },
  })

  tree.iterate({
    from: 0,
    to: preambleExtent.to,
    enter(nodeRef: SyntaxNodeRef) {
      return headMatcher(nodeRef.type)?.(nodeRef)
    },
  })

  tree.iterate({
    from: preambleExtent.to,
    enter(nodeRef: SyntaxNodeRef) {
      if (nodeRef.to <= preambleExtent.to) {
        return false
      }
      return visitBodyNode(nodeRef)
    },
  })

  let text = ''
  let position = range.from
  const mergedTransparentRanges = mergeRanges(transparentRanges)
  const mergedCollapsedRanges = mergeRanges(collapsedRanges)

  const gapHasVisibleWhitespace = (gap: SourceRange) => {
    let cursor = gap.from

    for (const span of mergedCollapsedRanges) {
      if (span.to <= cursor) {
        continue
      }
      if (span.from >= gap.to) {
        break
      }

      if (/\s/u.test(content.substring(cursor, Math.max(cursor, span.from)))) {
        return true
      }
      cursor = Math.max(cursor, Math.min(span.to, gap.to))
    }

    return /\s/u.test(content.substring(cursor, gap.to))
  }

  for (const textNode of textNodes) {
    const gap = {
      from: position,
      to: textNode.from,
    }
    const isTransparentGap =
      gap.from < gap.to &&
      mergedTransparentRanges.some(
        span => span.from <= gap.from && span.to >= gap.to
      ) &&
      !gapHasVisibleWhitespace(gap) &&
      !boundaryPositions.some(
        position => position >= gap.from && position <= gap.to
      ) &&
      !boundaryRanges.some(span => rangesOverlap(span, gap))

    if (gap.from < gap.to && !isTransparentGap) {
      text += ' '
    }
    text += textNode.text
    position = textNode.to
  }

  for (const value of segmenters.word.segment(
    text.replace(/\w[-_]\w/g, 'aaa')
  )) {
    if (value.isWordLike) {
      result.totalWords++
    }
  }

  for (const sentence of sentenceSegmenter.segment(text)) {
    for (const word of segmenters.word.segment(sentence.segment)) {
      if (word.isWordLike) {
        result.sentences++
        break
      }
    }
  }

  return result
}
