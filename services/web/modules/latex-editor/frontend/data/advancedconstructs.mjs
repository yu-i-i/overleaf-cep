export const advancedConstructsCategory = {
    name: 'Advanced Constructs',
    label: 'Σᵢ₌₁ⁿ xᵢ, ∏ᵢ₌₁ⁿ xᵢ',
    symbols: [
        // --- Limits / Summations with Arguments ---
        {
            label: '∑limits', latex: String.raw`\sum_{i=1}^{n} x_i `, description: 'Summation with limits (sum over a range, e.g., i = 1..n).'
        },
        { label: '∏limits', latex: String.raw`\prod_{ i=1 }^{n} x_i `, description: 'Product with limits(product over a range).' },
        {
            label: '∫limits', latex: String.raw`\int_{a}^{b} f(x) dx `, description: 'Definite integral from a to b of f(x).'
        },
        { label: 'lim', latex: String.raw`\lim_{ x \to \infty } f(x) `, description: 'Limit of a function as the variable approaches a value(or infinity).' },

        // --- Grouping & Stacking ---
        {
            label: '⏞ brace', latex: String.raw`\overbrace{x+y}^{text} `, description: 'Overbrace grouping with annotation above the expression.'
        },
        { label: '⏟ brace', latex: String.raw`\underbrace{ x + y }_{ text } `, description: 'Underbrace grouping with annotation below the expression.' },
        {
            label: 'overset', latex: String.raw`\overset{above}{base} `, description: 'Place an expression above another (annotation above a base).'
        },
        { label: 'underset', latex: String.raw`\underset{ below } { base } `, description: 'Place an expression below another(annotation below a base).' },
        {
            label: 'stackrel', latex: String.raw`\stackrel{top}{bottom} `, description: 'Stack one expression above another, commonly for annotated relations.'
        }
    ]
}

export default advancedConstructsCategory
