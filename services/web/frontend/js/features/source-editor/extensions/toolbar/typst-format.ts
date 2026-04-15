import { EditorView } from '@codemirror/view'

let formatModule: { format: (input: string, config: object) => string } | null =
    null
let loadingPromise: Promise<typeof formatModule> | null = null

async function loadTypstyle() {
    if (formatModule) return formatModule
    if (!loadingPromise) {
        loadingPromise = import('@typstyle/typstyle-wasm-bundler').then(mod => {
            formatModule = mod
            return mod
        })
    }
    return loadingPromise
}

export function typstFormatDocument(view: EditorView) {
    const doc = view.state.doc.toString()
    loadTypstyle()
        .then(mod => {
            if (!mod) return
            const formatted = mod.format(doc, {})
            if (formatted !== doc) {
                view.dispatch({
                    changes: { from: 0, to: view.state.doc.length, insert: formatted },
                })
            }
        })
        .catch(err => {
            console.error('[typst-format] Formatting failed:', err)
        })
}
