import { NodeType, type SyntaxNodeRef } from '@lezer/common'
import { LaTeXLanguage } from '@/features/source-editor/languages/latex/latex-language'
import { findPreambleExtent } from '@/features/word-count-modal/utils/find-preamble-extent'
import type { Segmenters } from '@/features/word-count-modal/utils/segmenters'

type SourceRange = {
  from: number
  to: number
}

type TextNode = SourceRange & {
  text: string
}

export type SelectedWordCountResult = {
  totalWords: number
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
  ['textbackslash', '\\'],
])

export const countWordsInSelection = (
  content: string,
  sourceRange: SourceRange,
  segmenters: Segmenters
): SelectedWordCountResult => {
  const result: SelectedWordCountResult = {
    totalWords: 0,
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
  const boundaryRanges: SourceRange[] = []

  const intersectsRange = (span: SourceRange) =>
    span.to > range.from && span.from < range.to

  const rangesOverlap = (left: SourceRange, right: SourceRange) =>
    left.to > right.from && left.from < right.to

  const isContainedInRange = (span: SourceRange) =>
    span.from >= range.from && span.to <= range.to

  const addBoundaryRange = (span: SourceRange) => {
    if (intersectsRange(span)) {
      boundaryRanges.push(span)
    }
  }

  const addTransparentRange = (span: SourceRange) => {
    if (intersectsRange(span)) {
      transparentRanges.push(span)
    }
  }

  const addSourceTextNode = (nodeRef: SyntaxNodeRef) => {
    if (!intersectsRange(nodeRef)) {
      return
    }

    const from = Math.max(nodeRef.from, range.from)
    const to = Math.min(nodeRef.to, range.to)

    textNodes.push({
      from,
      to,
      text: content.substring(from, to),
    })
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

  const state = {
    skipping: false,
  }

  const visitBodyNode = (nodeRef: SyntaxNodeRef): boolean | void => {
    if (state.skipping && !nodeRef.type.is('Comment')) {
      return
    }
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
    addBoundaryRange(nodeRef)

    const comment = content.slice(nodeRef.from, nodeRef.to)
    const match = /^%+TC:\s*(\w+)\s*/i.exec(comment)

    if (!match) {
      return
    }

    switch (match[1].toLowerCase()) {
      case 'ignore':
        state.skipping = true
        break
      case 'endignore':
        state.skipping = false
        break
      default:
        break
    }
  }

  const handleEnvironment = (nodeRef: SyntaxNodeRef) => {
    const envNameNode = nodeRef.node
      .getChild('BeginEnv')
      ?.getChild('EnvNameGroup')
      ?.getChild('EnvName')

    if (!envNameNode) {
      return
    }

    const envName = content
      .substring(envNameNode.from, envNameNode.to)
      .replace(/\*$/, '')

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
      if (intersectsRange(nodeRef)) {
        result.headers++
      }
      iterateNode(nodeRef)
      return false
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

      const replacement = replacementsMap.get(commandName)
      if (replacement === undefined) {
        return
      }

      addSyntheticTextNode(macro, replacement, nodeRef)
      return false
    },
    $Environment(nodeRef) {
      return handleEnvironment(nodeRef)
    },
    '$ToggleTextFormattingCommand $OtherTextFormattingCommand'(nodeRef) {
      addTransparentRange(nodeRef)
    },
    BeginEnv() {
      return false
    },
    Math(nodeRef) {
      if (!intersectsRange(nodeRef)) {
        return false
      }

      addBoundaryRange(nodeRef)

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

  const preambleExtent = findPreambleExtent(tree)

  tree.iterate({
    from: 0,
    to: preambleExtent.to,
    enter(nodeRef: SyntaxNodeRef) {
      if (state.skipping && !nodeRef.type.is('Comment')) {
        return
      }
      return headMatcher(nodeRef.type)?.(nodeRef)
    },
  })

  tree.iterate({
    from: preambleExtent.to,
    enter(nodeRef: SyntaxNodeRef) {
      return visitBodyNode(nodeRef)
    },
  })

  let text = ''
  let position = range.from
  const mergedTransparentRanges = mergeRanges(transparentRanges)

  for (const textNode of textNodes) {
    const gap = {
      from: position,
      to: textNode.from,
    }
    const isTransparentGap =
      gap.from < gap.to &&
      !/\s/u.test(content.substring(gap.from, gap.to)) &&
      mergedTransparentRanges.some(
        span => span.from <= gap.from && span.to >= gap.to
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

  return result
}
