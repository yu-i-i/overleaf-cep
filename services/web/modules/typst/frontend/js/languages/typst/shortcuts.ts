import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { wrapRanges } from '@/features/source-editor/commands/ranges'
import { typstFormatDocument } from '@/features/source-editor/extensions/toolbar/typst-format'

export const shortcuts = () => {
    return Prec.high(
        keymap.of([
            {
                key: 'Ctrl-b',
                mac: 'Mod-b',
                preventDefault: true,
                run: wrapRanges('*', '*'),
            },
            {
                key: 'Ctrl-i',
                mac: 'Mod-i',
                preventDefault: true,
                run: wrapRanges('_', '_'),
            },
            {
                key: 'Ctrl-Shift-f',
                mac: 'Mod-Shift-f',
                preventDefault: true,
                run: (view) => {
                    typstFormatDocument(view)
                    return true
                },
            },
        ])
    )
}
