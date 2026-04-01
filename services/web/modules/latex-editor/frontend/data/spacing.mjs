export const spacingCategory = {
    name: 'Spacing',
    label: 'Spacing',
    symbols: [
        {
            "label": "space (large)",
            "latex": String.raw`\quad `,
            "description": "horizontal space (TeX) — a wide space in math mode."
        },
        {
            "label": "space (very large)",
            "latex": String.raw`\qquad `,
            "description": "Wide space."
        },
        {
            "label": "space(medium)",
            "latex": String.raw`\; `,
            "description": "medium space (TeX) — spacing command in math mode."
        },
        {
            "label": "space (medium)",
            "latex": String.raw`\: `,
            "description": "Medium space"
        },
        {
            "label": "space (thin)",
            "latex": String.raw`\, `,
            "description": "thin space (TeX) — small spacing command in math mode."
        },
        {
            "label": "space (normal)",
            "latex": String.raw`\ `,
            "description": "Normal space — regular inter-word space in math mode."
        },
        {
            "label": "no break space",
            "latex": "~",
            "description": "Non-breaking space — prevents line breaks between words; also used for similarity relation."
        },
        {
            "label": "space (negative)",
            "latex": String.raw`\! `,
            "description": "negative thin space (TeX) — reduces space in math mode."
        }
    ]
};

export default spacingCategory