export const fractionsCategory = {
    name: 'Fractions & Scripts',
    label: 'ⁿ√, xⁿ, a/b',
    symbols: [
        { label: 'ⁿ√', latex: String.raw`\sqrt[n]{x}`, description: "Nth root notation — String.raw`\sqrt[n]{x} expresses the n-th root of x." },
        { label: '√', latex: String.raw`\sqrt{x}`, description: "Square root (√) — returns a number whose square equals the given value." },
        { label: 'xⁿ', latex: 'x^{n}', description: 'Superscript template — places the following content into a superscript (e.g., x^{y}).' },
        { label: 'x₂', latex: 'x_{i}', description: 'Subscript template — places content in a subscript (e.g., A_{ij}).' },
        { label: 'x²', latex: 'x^2', description: 'Superscript 2 — squared (x^2).' },
        { label: 'x³', latex: 'x^3', description: 'Superscript 3 — cubed (x^3).' },
        { label: 'eˣ', latex: 'e^{x}', description: 'Exponential with base e — use e^{...} to denote the exponential function.' },
        { label: 'a/b', latex: String.raw`\frac{a}{b}`, description: 'Fraction — rational number or ratio notation String.raw`\frac{a}{b}.' },
        { label: 'binomial', latex: String.raw`\binom{n}{k}`, description: 'Binomial coefficient — combinations notation C(n, k).' },
        { label: 'a/b (Display)', latex: String.raw`\dfrac{a}{b}`, description: 'Display-style fraction (dfrac) for larger numerators/denominators.' },
        { label: 'a/b (Text)', latex: String.raw`\tfrac{a}{b}`, description: 'Text-style fraction (tfrac) for inline fractions.' },
        { label: 'cfrac', latex: String.raw`\cfrac{a}{b}`, description: 'Continued fraction style (cfrac) for nested fractions.' },

        // --- Superscripts & Subscripts (merged) ---
        { label: 'x²₃', latex: 'x^{2}_{3}', placeholder: 'x,2,3', description: 'Combined superscript and subscript on the same base.' },
        { label: "x'", latex: "x'", description: 'Prime notation (e.g., derivative or transformed variable).' },
        { label: "x''", latex: "x''", description: 'Double prime notation (second derivative or successive primes).' },
        { label: 'x⁽ⁿ⁾', latex: 'x^{(n)}', placeholder: 'x,n', description: 'Parenthesized superscript, often used for nth derivatives or indexed exponents.' }
    ]
};

export default fractionsCategory
