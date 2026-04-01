export const fontStylesCategory = {
    name: 'Font Styles',
    label: 'ℕ ℤ ℚ',
    symbols: [
        // --- Blackboard Bold (Common Sets) ---
        { label: 'ℕ', latex: String.raw`\mathbb{N}`, description: 'Blackboard- bold N: the set of natural numbers.' },
        { label: 'ℤ', latex: String.raw`\mathbb{Z}`, description: 'Blackboard- bold Z: the set of integers.' },
        { label: 'ℚ', latex: String.raw`\mathbb{Q}`, description: 'Blackboard- bold Q: the set of rational numbers.' },
        { label: 'ℝ', latex: String.raw`\mathbb{R}`, description: 'Blackboard- bold R: the set of real numbers.' },
        { label: 'ℂ', latex: String.raw`\mathbb{C}`, description: 'Blackboard- bold C: the set of complex numbers.' },

        // --- Font Commands ---
        {
            label: String.raw`\mathcal{A}`, latex: String.raw`\mathcal{A}`, placeholder: 'A', description: 'Calligraphic uppercase A, often used for sets or collections.'
        },

        { label: String.raw`\mathfrak{A}`, latex: String.raw`\mathfrak{A}`, placeholder: 'A', description: 'Fraktur - style A, used in algebraic or number- theory contexts.' },
        {
            label: String.raw`\mathbf{a}`, latex: String.raw`\mathbf{a}`, placeholder: 'a', description: 'Bold math font, frequently used for vectors or emphasis.'
        },

        {
            label: String.raw`\mathit{a}`, latex: String.raw`\mathit{a}`, placeholder: 'a', description: 'Math italic font(explicit italic).'
        },

        {
            label: String.raw`\mathtt{a}`, latex: String.raw`\mathtt{a}`, placeholder: 'a', description: 'Monospace / typewriter math font.'
        },

        {
            label: String.raw`\mathsf{a}`, latex: String.raw`\mathsf{a}`, placeholder: 'a', description: 'Sans - serif math font.'
        },

        {
            label: String.raw`\mathrm{a}`, latex: String.raw`\mathrm{a}`, placeholder: 'a', description: 'Upright roman math font, for text - like symbols.'
        },

        {
            label: String.raw`\mathbb{a}`, latex: String.raw`\mathbb{a}`, placeholder: 'a', description: 'Blackboard - bold lowercase letter style.'
        },


        // --- Text within Math Mode ---
        {
            label: String.raw`\text{...}`, latex: String.raw`\text{text}`, placeholder: 'text', description: 'Insert normal(roman) text inside math mode.'
        },

        {
            label: String.raw`\textbf{...}`, latex: String.raw`\textbf{text}`, placeholder: 'text', description: 'Bold text inside math mode.'
        },

        { label: String.raw`\textit{...}`, latex: String.raw`\textit{text}`, placeholder: 'text', description: 'Italic text inside math mode.' }
    ]
}

export default fontStylesCategory
