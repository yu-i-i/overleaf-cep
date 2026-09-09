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
): number => {
  const range = {
    from: Math.max(0, Math.min(sourceRange.from, content.length)),
    to: Math.max(0, Math.min(sourceRange.to, content.length)),
  }

  if (range.from >= range.to) {
    return 0
  }

  const tree = LaTeXLanguage.parser.parse(content)
  const textNodes: TextNode[] = []

  const intersectsRange = (span: SourceRange) =>
    span.to > range.from && span.from < range.to

  const isContainedInRange = (span: SourceRange) =>
    span.from >= range.from && span.to <= range.to

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

  const iterateNode = (nodeRef: SyntaxNodeRef) => {
    nodeRef.node.cursor().iterate(childNodeRef => {
      if (childNodeRef.node !== nodeRef.node) {
        return bodyMatcher(childNodeRef.type)?.(childNodeRef)
      }
    })
  }

  const state = {
    skipping: false,
  }

  const handleComment = (nodeRef: SyntaxNodeRef) => {
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
    BeginEnv() {
      return false
    },
    Math() {
      return false
    },
    'ShortTextArgument ShortOptionalArg'() {
      return false
    },
    SectioningArgument(nodeRef) {
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
    'IncludeArgument InputArgument SubfileArgument'() {
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
      if (state.skipping && !nodeRef.type.is('Comment')) {
        return
      }
      return bodyMatcher(nodeRef.type)?.(nodeRef)
    },
  })

  let text = ''
  let position = 0

  for (const textNode of textNodes) {
    if (textNode.from !== position) {
      text += ' '
    }
    text += textNode.text
    position = textNode.to
  }

  let words = 0
  for (const value of segmenters.word.segment(
    text.replace(/\w[-_]\w/g, 'aaa')
  )) {
    if (value.isWordLike) {
      words++
    }
  }

  return words
}
