// overleaf-lab: tiny cross-component store for the chat's currently selected
// model id. The chat panel (use-llm-chat) and the selection toolbar / "Ask AI"
// (llm-toolbar) live in separate React trees, so a plain module value would not
// survive between them. localStorage bridges the two: the chat writes the chosen
// model, the toolbar reads it so "Ask AI" uses the same model as the chat.
const STORAGE_KEY = 'llm.chat.selectedModel'

export function readSelectedModel(): string {
    try {
        return window.localStorage.getItem(STORAGE_KEY) || ''
    } catch {
        return '' // storage disabled / private mode: fall back to server default
    }
}

export function writeSelectedModel(modelId: string): void {
    try {
        if (modelId) {
            window.localStorage.setItem(STORAGE_KEY, modelId)
        } else {
            window.localStorage.removeItem(STORAGE_KEY)
        }
    } catch {
        // ignore: storage disabled / private mode
    }
}
