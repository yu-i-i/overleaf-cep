import { syntaxTree } from '@codemirror/language'
import { Diagnostic, LintSource } from '@codemirror/lint'
import { createLinter } from '@/features/source-editor/extensions/linting'

export const typstLinter = () => createLinter(typstLintSource, { delay: 100 })

export const typstLintSource: LintSource = view => {
    const tree = syntaxTree(view.state)
    const diagnostics: Diagnostic[] = []

    tree.iterate({
        enter(node) {
            if (node.type.name === 'Error') {
                const { from, to } = node
                diagnostics.push({
                    from,
                    to,
                    severity: 'error',
                    message: 'Syntax error',
                })
            }
        },
    })

    return diagnostics
}
