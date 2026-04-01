export const operatorsCategory = {
    name: 'Operators',
    label: '+ − ×',
    symbols: [
        {
            "label": "+",
            "latex": "+ ",
            "description": "Plus sign"
        },
        {
            "label": "−",
            "latex": "- ",
            "description": "Minus sign — subtraction operator or negative sign."
        },
        {
            "label": "×",
            "latex": String.raw`\times `,
            "description": "multiplication sign — binary multiplication operator (×)."
        },
        {
            "label": "·",
            "latex": String.raw`\cdot `,
            "description": "centered dot — multiplication or scalar product notation."
        },
        {
            "label": "∙",
            "latex": String.raw`\bullet `,
            "description": "bullet operator — typographic bullet or operator."
        },
        {
            "label": "÷",
            "latex": String.raw`\div `,
            "description": "division sign (÷)."
        },
        {
            "label": "±",
            "latex": String.raw`\pm `,
            "description": "plus–minus sign — indicates two possible signs (plus or minus)."
        },
        {
            "label": "∓",
            "latex": String.raw`\mp `,
            "description": "minus–plus sign — complementary to plus–minus in formulas."
        },
        {
            "label": "=",
            "latex": "= ",
            "description": "Equal sign"
        },
        {
            "label": "≠",
            "latex": String.raw`\neq `,
            "description": "not equal to — inequality relation."
        },
        {
            "label": "≈",
            "latex": String.raw`\approx `,
            "description": "approximately equal to — indicates approximate equality."
        },
        {
            "label": "≡",
            "latex": String.raw`\equiv `,
            "description": "identical or congruent relation (≡)."
        },
        {
            "label": "<",
            "latex": "< ",
            "description": "Less than"
        },
        {
            "label": ">",
            "latex": "> ",
            "description": "Greater than"
        },
        {
            "label": "≤",
            "latex": String.raw`\leq `,
            "description": "less-than-or-equal-to relation."
        },
        {
            "label": "≥",
            "latex": String.raw`\geq `,
            "description": "greater-than-or-equal-to relation."
        },
        {
            "label": "≪",
            "latex": String.raw`\ll `,
            "description": "much less than — strong inequality."
        },
        {
            "label": "≫",
            "latex": String.raw`\gg `,
            "description": "much greater than — strong inequality."
        },
        {
            "label": "∗",
            "latex": String.raw`\ast `,
            "description": "Asterisk operator"
        },
        {
            "label": "⋆",
            "latex": String.raw`\star `,
            "description": "Star symbol."
        },
        {
            "label": "∘",
            "latex": String.raw`\circ `,
            "description": "circle operator — function composition or small circle symbol."
        },
        {
            "label": "⊕",
            "latex": String.raw`\oplus `,
            "description": "direct sum / circled plus operator."
        },
        {
            "label": "⊖",
            "latex": String.raw`\ominus `,
            "description": "Circled minus."
        },
        {
            "label": "⊗",
            "latex": String.raw`\otimes `,
            "description": "tensor product / circled multiplication operator."
        },
        {
            "label": "⊘",
            "latex": String.raw`\oslash `,
            "description": "Circled slash."
        },
        {
            "label": "⊙",
            "latex": String.raw`\odot `,
            "description": "Circled dot (scalar product)."
        },
        {
            "label": "∪",
            "latex": String.raw`\cup `,
            "description": "set union."
        },
        {
            "label": "∩",
            "latex": String.raw`\cap `,
            "description": "set intersection."
        },
        {
            "label": "⊔",
            "latex": String.raw`\sqcup `,
            "description": "Square union."
        },
        {
            "label": "⊓",
            "latex": String.raw`\sqcap `,
            "description": "Square intersection."
        },
        {
            "label": "∨",
            "latex": String.raw`\vee `,
            "description": "Logical OR."
        },
        {
            "label": "∧",
            "latex": String.raw`\wedge `,
            "description": "Logical AND."
        },
        {
            "label": "⊎",
            "latex": String.raw`\uplus `,
            "description": "Disjoint union."
        },
        {
            "label": "△",
            "latex": String.raw`\triangle `,
            "description": "triangle symbol — used for difference, Laplacian, or geometric triangle (context-dependent)."
        },
        {
            "label": "▽",
            "latex": String.raw`\bigtriangledown `,
            "description": "Big downward triangle"
        },
        {
            "label": "◃",
            "latex": String.raw`\triangleleft `,
            "description": "Left-pointing triangle (used as a relation)."
        },
        {
            "label": "▹",
            "latex": String.raw`\triangleright `,
            "description": "Right-pointing triangle (used as a relation)."
        },
        {
            "label": "∝",
            "latex": String.raw`\propto `,
            "description": "proportional to — indicates direct proportionality between quantities."
        },
        {
            "label": "≍",
            "latex": String.raw`\asymp `,
            "description": "Asymptotic equivalence"
        },
        {
            "label": "≊",
            "latex": String.raw`\approxeq `,
            "description": "Approximate equality"
        },
        {
            "label": "∼",
            "latex": String.raw`\sim `,
            "description": "similar or asymptotically equal — used for equivalence/proportionality contexts."
        },
        {
            "label": "≃",
            "latex": String.raw`\simeq `,
            "description": "asymptotic equivalence or similarity."
        },
        {
            "label": "≅",
            "latex": String.raw`\cong `,
            "description": "congruent or isomorphic — equality up to congruence or isomorphism."
        },
        {
            "label": "≢",
            "latex": String.raw`\not\equiv `,
            "description": "Not identically equal."
        },
        {
            "label": "≺",
            "latex": String.raw`\prec `,
            "description": "precedes relation — ordering relation."
        },
        {
            "label": "≻",
            "latex": String.raw`\succ `,
            "description": "succeeds relation — ordering relation."
        },
        {
            "label": "≼",
            "latex": String.raw`\preceq `,
            "description": "Precedes or equal."
        },
        {
            "label": "≽",
            "latex": String.raw`\succeq `,
            "description": "Greater than or equal to in order relations."
        },
        {
            "label": "∈",
            "latex": String.raw`\in  `,
            "description": "element of — membership relation."
        },
        {
            "label": "∉",
            "latex": String.raw`\notin `,
            "description": "not an element of — negated membership."
        },
        {
            "label": "∋",
            "latex": String.raw`\ni `,
            "description": "contains / has as member — reversed membership relation (∋)."
        },
        {
            "label": "⊂",
            "latex": String.raw`\subset `,
            "description": "proper subset relation."
        },
        {
            "label": "⊃",
            "latex": String.raw`\supset `,
            "description": "proper superset relation."
        },
        {
            "label": "⊆",
            "latex": String.raw`\subseteq `,
            "description": "subset or equal relation."
        },
        {
            "label": "⊇",
            "latex": String.raw`\supseteq `,
            "description": "Superset or equal."
        },
        {
            "label": "⊄",
            "latex": String.raw`\not\subset `,
            "description": "Not subset of."
        },
        {
            "label": "⊅",
            "latex": String.raw`\not\supset `,
            "description": "Not superset of."
        },
        {
            "label": "⊢",
            "latex": String.raw`\vdash `,
            "description": "Logical turnstile, entails."
        },
        {
            "label": "⊣",
            "latex": String.raw`\dashv `,
            "description": "Left tack, often used for adjoint or inverse relations."
        },
        {
            "label": "∥",
            "latex": String.raw`\parallel `,
            "description": "parallel — denotes parallel lines or relations (∥)."
        },
        {
            "label": "∦",
            "latex": String.raw`\not\parallel `,
            "description": "Not parallel."
        },
        {
            "label": "⊥",
            "latex": String.raw`\perp `,
            "description": "perpendicular/orthogonal — denotes right-angle relation (⊥)."
        },
        {
            "label": "∑",
            "latex": String.raw`\sum `,
            "description": "Summation (Σ) — sum of a sequence of terms over an index."
        },
        {
            "label": "∏",
            "latex": String.raw`\prod `,
            "description": "Product (∏) — product of a sequence of factors over an index."
        },
        {
            "label": "∫",
            "latex": String.raw`\int `,
            "description": "Integral — represents accumulation or area under a curve."
        },
        {
            "label": "∂",
            "latex": String.raw`\partial `,
            "description": "Partial derivative symbol (∂). Use for multivariable derivatives."
        },
        {
            "label": "∇",
            "latex": String.raw`\nabla `,
            "description": "Nabla (∇) — vector differential operator (del)."
        }
    ]
};

export default operatorsCategory