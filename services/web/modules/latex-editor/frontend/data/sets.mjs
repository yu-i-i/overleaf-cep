/* eslint-disable no-useless-escape */
export const setsCategory = {
    name: 'Sets & Logic',
    label: '∈ ∉ ⊂',
    symbols: [
        {
            "label": "∈",
            "latex": String.raw`\in `,
            "description": "element of — membership relation."
        },
        {
            "label": "∉",
            "latex": String.raw`\notin `,
            "description": "not an element of — negated membership."
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
            "label": "∅",
            "latex": String.raw`\emptyset `,
            "description": "empty set — set with no elements (∅)."
        },
        {
            "label": "set minus",
            "latex": String.raw`\setminus `,
            "description": "set minus / backslash — set difference operator."
        },
        {
            "label": "ℝ",
            "latex": String.raw`\mathbb{R} `,
            "description": "Set of real numbers (ℝ)."
        },
        {
            "label": "ℕ",
            "latex": String.raw`\mathbb{ N } `,
            "description": "Set of natural numbers (ℕ)."
        },
        {
            "label": "ℤ",
            "latex": String.raw`\mathbb{Z} `,
            "description": "Set of integers (ℤ)."
        },
        {
            "label": "ℚ",
            "latex": String.raw`\mathbb{Q} `,
            "description": "Set of rational numbers (ℚ)."
        },
        {
            "label": "ℂ",
            "latex": String.raw`\mathbb{C} `,
            "description": "Set of complex numbers (ℂ)."
        },
        {
            "label": "∀",
            "latex": String.raw`\forall `,
            "description": "universal quantifier — 'for all' in logic."
        },
        {
            "label": "∃",
            "latex": String.raw`\exists `,
            "description": "existential quantifier — 'there exists' in logic."
        },
        {
            "label": "∧",
            "latex": String.raw`\land `,
            "description": "logical and — conjunction (∧)."
        },
        {
            "label": "∨",
            "latex": String.raw`\lor `,
            "description": "logical or — disjunction (∨)."
        },
        {
            "label": "¬",
            "latex": String.raw`\lnot `,
            "description": "logical negation — 'not' operator in logic."
        },
        {
            "label": "⊤",
            "latex": String.raw`\top `,
            "description": "Top element or truth value, often in logic."
        },
        {
            "label": "⊥",
            "latex": String.raw`\bot `,
            "description": "Perpendicular (bottom)"
        },
        {
            "label": "∫",
            "latex": String.raw`\int `,
            "description": "Integral — operator representing accumulation; computes area under a curve in calculus."
        },
        {
            "label": "∬",
            "latex": String.raw`\iint `,
            "description": "double integral operator."
        },
        {
            "label": "∭",
            "latex": String.raw`\iiint `,
            "description": "triple integral operator."
        },
        {
            "label": "∮",
            "latex": String.raw`\oint `,
            "description": "Circular contour integral."
        },
        {
            "label": "∑",
            "latex": String.raw`\sum `,
            "description": "Summation — notation (Σ) for adding a sequence of terms."
        },
        {
            "label": "∏",
            "latex": String.raw`\prod `,
            "description": "Product (∏) — product of a sequence of factors over an index."
        },
        {
            "label": "∐",
            "latex": String.raw`\coprod `,
            "description": "Coproduct operator"
        },
        {
            "label": "∂",
            "latex": String.raw`\partial `,
            "description": "Partial derivative symbol (∂) — denotes differentiation with respect to one variable in multivariable calculus."
        },
        {
            "label": "∇",
            "latex": String.raw`\nabla `,
            "description": "Nabla (∇) — vector differential operator (del), used for gradient, divergence, and curl."
        },
        {
            "label": "∞",
            "latex": String.raw`\infty `,
            "description": "Infinity (∞) — concept of an unbounded quantity larger than any real number."
        },
        {
            "label": "lim",
            "latex": String.raw`\lim `,
            "description": "Limit — value that a function or sequence 'approaches' as the input approaches some point."
        },
        {
            "label": "sup",
            "latex": String.raw`\sup `,
            "description": "Supremum (least upper bound)."
        },
        {
            "label": "inf",
            "latex": String.raw`\inf `,
            "description": "Infimum (greatest lower bound)."
        },
        {
            "label": "max",
            "latex": String.raw`\max `,
            "description": "Maximum value."
        },
        {
            "label": "min",
            "latex": String.raw`\min `,
            "description": "Minimum value."
        },
        {
            "label": "lim sup",
            "latex": String.raw`\limsup `,
            "description": "Limit — value that a function approaches as input approaches some point."
        },
        {
            "label": "lim inf",
            "latex": String.raw`\liminf `,
            "description": "Limit — value that a function approaches as input approaches some point."
        },
        {
            "label": "(",
            "latex": "( ",
            "description": "Left parenthesis"
        },
        {
            "label": ")",
            "latex": ") ",
            "description": "Right parenthesis"
        },
        {
            "label": "[",
            "latex": "[ ",
            "description": "Left square bracket"
        },
        {
            "label": "]",
            "latex": "] ",
            "description": "Closing square bracket."
        },
        {
            "label": "{",
            "latex": String.raw`\{ `,
            "description": "Left curly brace — literal '{' used in math mode (use \\\{ to typeset a literal brace)."
        },
        {
            "label": "}",
            "latex": String.raw`\} `,
            "description": "Right curly brace — literal '}' used in math mode (use \\\} to typeset a literal brace)."
        },
        {
            "label": "⟨",
            "latex": String.raw`\langle `,
            "description": "left angle bracket (bra) — used in inner-product notation ⟨·,·⟩."
        },
        {
            "label": "⟩",
            "latex": String.raw`\rangle `,
            "description": "right angle bracket (ket) — used in inner-product notation ⟨·,·⟩."
        },
        {
            "label": "|",
            "latex": "| ",
            "description": "Double vertical bar, similar to \\right|, often used for norms."
        },
        {
            "label": "‖",
            "latex": String.raw`\Vert `,
            "description": "Parallel symbols (double vertical line)"
        },
        {
            "label": "⌈",
            "latex": String.raw`\lceil `,
            "description": "Left ceiling function."
        },
        {
            "label": "⌉",
            "latex": String.raw`\rceil `,
            "description": "Right ceiling function."
        },
        {
            "label": "⌊",
            "latex": String.raw`\lfloor `,
            "description": "Left floor function."
        },
        {
            "label": "⌋",
            "latex": String.raw`\rfloor `,
            "description": "Right floor function."
        }
    ]
};

export default setsCategory