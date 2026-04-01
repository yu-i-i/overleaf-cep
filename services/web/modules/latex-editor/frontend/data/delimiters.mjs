/* eslint-disable no-useless-escape */
export const delimitersCategory = {
    name: 'Delimiters',
    label: '( { [',
    symbols: [
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
            "description": "Left curly brace."
        },
        {
            "label": "}",
            "latex": String.raw`\} `,
            "description": "Right curly brace."
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
            "description": "Vertical bar — used for absolute value, determinants, or divides relation."
        },
        {
            "label": "‖",
            "latex": String.raw`\| `,
            "description": "Double vertical bar — used for norms or parallel notation."
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
            "label": "left(",
            "latex": String.raw`\left( `,
            "description": "Left parenthesis, size-adjusted."
        },
        {
            "label": "right)",
            "latex": String.raw`\right) `,
            "description": "Closes a parenthesis, used in automatic sizing with left."
        },
        {
            "label": "left[",
            "latex": String.raw`\left[ `,
            "description": "Left square bracket, size-adjusted."
        },
        {
            "label": "right]",
            "latex": String.raw`\right] `,
            "description": "Closes a square bracket, used with left for sizing."
        },
        {
            "label": "left{",
            "latex": String.raw`\left\{ `,
            "description": "Left curly brace."
        },
        {
            "label": "right}",
            "latex": String.raw`\right\} `,
            "description": "Right curly brace that auto-scales to its contents."
        },
        {
            "label": "left langle",
            "latex": String.raw`\left\langle`,
            "description": "Left double angle bracket."
        },
        {
            "label": "right rangle",
            "latex": String.raw`\right\rangle`,
            "description": "Right angle bracket, often used for inner products or bra-ket notation."
        },
        {
            "label": "left|",
            "latex": String.raw`\left | `,
            "description": "Left double vertical bar (norm)."
        },
        {
            "label": "right|",
            "latex": String.raw`\right | `,
            "description": "Double vertical bar, used for norms or parallelism."
        },
        {
            "label": "left ||",
            "latex": String.raw`\left\| `,
            "description": "Auto-sizing double vertical line (left) — used for norms or parallel notation and scales with content."
        },
        {
            "label": "right ||",
            "latex": String.raw`\right\| `,
            "description": "Auto-sizing double vertical line (right) — used for norms or parallel notation and scales with content."
        },
        {
            "label": "big(",
            "latex": String.raw`\big( `,
            "description": "Big size parenthesis"
        },
        {
            "label": "big)",
            "latex": String.raw`\big) `,
            "description": "Big size parenthesis"
        },
        {
            "label": "big[",
            "latex": String.raw`\big[ `,
            "description": "Big size square bracket"
        },
        {
            "label": "big]",
            "latex": String.raw`\big] `,
            "description": "Big size closing bracket"
        },
        {
            "label": "big{",
            "latex": String.raw`\big\{ `,
            "description": "Fixed-size medium curly brace - larger than default but not auto-sizing."
        },
        {
            "label": "big}",
            "latex": String.raw`\big\} `,
            "description": "Fixed-size medium right curly brace)."
        },
        {
            "label": "big⟨",
            "latex": String.raw`\big\langle `,
            "description": "Big size left angle"
        },
        {
            "label": "big⟩",
            "latex": String.raw`\big\rangle `,
            "description": "Big size right angle"
        },
        {
            "label": "Big(",
            "latex": String.raw`\Big( `,
            "description": "Large size left parenthesis"
        },
        {
            "label": "Big)",
            "latex": String.raw`\Big) `,
            "description": "Large size right parenthesis"
        },
        {
            "label": "Big[",
            "latex": String.raw`\Big[ `,
            "description": "Large size left square bracket"
        },
        {
            "label": "Big]",
            "latex": String.raw`\Big] `,
            "description": "Large right curly brace"
        },
        {
            "label": "Big{",
            "latex": String.raw`\Big\{ `,
            "description": "Fixed-size large curly brace"
        },
        {
            "label": "Big}",
            "latex": String.raw`\Big\} `,
            "description": "Fixed-size large right curly brace"
        },
        {
            "label": "Big⟨",
            "latex": String.raw`\Big\langle `,
            "description": "Large left angle bracket"
        },
        {
            "label": "Big⟩",
            "latex": String.raw`\Big\rangle `,
            "description": "Large right angle bracket"
        },
        {
            "label": "bigg(",
            "latex": String.raw`\bigg( `,
            "description": "Very big parenthesis"
        },
        {
            "label": "bigg)",
            "latex": String.raw`\bigg) `,
            "description": "Very big parenthesis"
        },
        {
            "label": "bigg[",
            "latex": String.raw`\bigg[ `,
            "description": "Very big square bracket"
        },
        {
            "label": "bigg]",
            "latex": String.raw`\bigg] `,
            "description": "Very big closing brace"
        },
        {
            "label": "bigg{",
            "latex": String.raw`\bigg\{ `,
            "description": "Fixed-size extra-large curly brace"
        },
        {
            "label": "bigg}",
            "latex": String.raw`\bigg\} `,
            "description": "Fixed-size extra-large right curly brace"
        },
        {
            "label": "bigg⟨",
            "latex": String.raw`\bigg\langle `,
            "description": "Very big left angle"
        },
        {
            "label": "bigg⟩",
            "latex": String.raw`\bigg\rangle `,
            "description": "Very big right angle"
        },
        {
            "label": "Bigg(",
            "latex": String.raw`\Bigg( `,
            "description": "Very large left parenthesis"
        },
        {
            "label": "Bigg)",
            "latex": String.raw`\Bigg) `,
            "description": "Very large right parenthesis"
        },
        {
            "label": "Bigg[",
            "latex": String.raw`\Bigg[ `,
            "description": "Very large left square bracket"
        },
        {
            "label": "Bigg]",
            "latex": String.raw`\Bigg] `,
            "description": "Very large right curly brace"
        },
        {
            "label": "Bigg{",
            "latex": String.raw`\Bigg\{ `,
            "description": "Fixed-size very large curly brace"
        },
        {
            "label": "Bigg}",
            "latex": String.raw`\Bigg\} `,
            "description": "Fixed-size very large right curly brace"
        },
        {
            "label": "Bigg⟨",
            "latex": String.raw`\Bigg\langle `,
            "description": "Very large left angle bracket"
        },
        {
            "label": "Bigg⟩",
            "latex": String.raw`\Bigg\rangle `,
            "description": "Very large right angle bracket"
        }
    ]
};

export default delimitersCategory