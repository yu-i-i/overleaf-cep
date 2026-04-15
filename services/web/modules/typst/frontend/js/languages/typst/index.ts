import { tags, styleTags } from '@lezer/highlight'
import { TypstParser } from 'codemirror-lang-typst'
import {
    HighlightStyle,
    LanguageSupport,
    Language,
    syntaxHighlighting,
    defineLanguageFacet,
} from '@codemirror/language'

import { shortcuts } from './shortcuts'
import { typstLinter } from './linter'

export const typstHighlight = styleTags({
    Shebang: tags.documentMeta,
    'LineComment BlockComment': tags.comment,

    Text: tags.content,
    Linebreak: tags.contentSeparator,
    Escape: tags.escape,
    Shorthand: tags.contentSeparator,
    SmartQuote: tags.quote,
    'Strong/...': tags.strong,
    'Emph/...': tags.emphasis,
    RawLang: tags.annotation,
    RawDelim: tags.controlKeyword,
    Raw: tags.monospace,
    Link: tags.link,
    Label: tags.labelName,
    'Ref/...': tags.labelName,
    'Heading/...': tags.heading,
    ListMarker: tags.list,
    EnumMarker: tags.list,
    TermMarker: tags.definitionOperator,

    MathText: tags.special(tags.string),
    MathIdent: tags.special(tags.variableName),
    'MathShorthand MathAlignPoint MathDelimited MathAttach MathPrimes MathFrac MathRoot':
        tags.special(tags.contentSeparator),

    Error: tags.invalid,

    Hash: tags.controlKeyword,
    'LeftBrace RightBrace': tags.brace,
    'LeftBracket RightBracket': tags.bracket,
    'LeftParen RightParen': tags.paren,
    Comma: tags.separator,
    'Semicolon Colon Dot Dots': tags.punctuation,
    Dollar: tags.controlKeyword,
    'Plus Minus Slash Hat': tags.arithmeticOperator,
    Prime: tags.typeOperator,
    'Eq PlusEq HyphEq SlashEq StarEq': tags.updateOperator,
    'EqEq ExclEq Lt LtEq Gt GtEq': tags.compareOperator,
    Arrow: tags.controlOperator,
    Root: tags.arithmeticOperator,

    'Not And Or': tags.operatorKeyword,
    'None Auto': tags.literal,
    'If Else For While Break Continue Return': tags.controlKeyword,
    'Import Include': tags.moduleKeyword,
    'Let Set Show Context': tags.definitionKeyword,
    'As In': tags.operatorKeyword,

    Code: tags.monospace,
    Ident: tags.variableName,
    Bool: tags.bool,
    Int: tags.integer,
    Float: tags.float,
    Numeric: tags.number,
    Str: tags.string,
})

const data = defineLanguageFacet({
    commentTokens: { block: { open: '/*', close: '*/' }, line: '//' },
})

export const TypstHighlightStyle = HighlightStyle.define([
    { tag: tags.link, textDecoration: 'underline' },
    { tag: tags.heading, fontWeight: 'bold', textDecoration: 'underline' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.literal, fontWeight: 'bold' },
    { tag: tags.punctuation, fontWeight: 'bold' },
    { tag: tags.controlKeyword, fontWeight: 'bold' },
    { tag: tags.annotation, fontWeight: 'bold' },
    { tag: tags.moduleKeyword, fontWeight: 'bold' },
    { tag: tags.operatorKeyword, fontWeight: 'bold' },
    { tag: tags.definitionKeyword, fontWeight: 'bold' },
    { tag: tags.contentSeparator, fontWeight: 'bold' },
    { tag: tags.definitionOperator, fontWeight: 'bold' },
    { tag: tags.list, fontWeight: 'bold' },
    { tag: tags.special(tags.contentSeparator), fontWeight: 'bolder' },
    {
        tag: tags.labelName,
        textDecoration: 'dotted blue underline',
        fontWeight: 'bold',
    },
    { tag: tags.monospace, fontFamily: 'monospace' },
])

export function typst(): LanguageSupport {
    const parser = new TypstParser(typstHighlight)
    const updateListener = parser.updateListener()
    return new LanguageSupport(
        new Language(
            data,
            parser,
            [updateListener, syntaxHighlighting(TypstHighlightStyle), shortcuts(), typstLinter()],
            'typst'
        )
    )
}
