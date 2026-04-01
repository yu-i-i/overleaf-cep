export const equationEnvironmentsCategory = {
    name: 'Equation Environments',
    label: 'Equ. Env.',
    symbols: [
        {
            label: 'equation', latex: String.raw`\begin{equation}
  E = mc^2
\end{equation}`, description: 'Numbered equation environment (single equation).'
        },
        {
            label: 'equation*', latex: String.raw`\begin{equation*}
  E = mc^2
\end{equation*}`, description: 'Unnumbered equation environment.'
        },
        {
            label: 'align', latex: String.raw`\begin{align}
  a &= b + c \\
  d &= e + f
\end{align}`, description: 'Aligned multiline equations with alignment points and automatic numbering.'
        },
        {
            label: 'align*', latex: String.raw`\begin{align*}
  a &= b + c \\
  d &= e + f
\end{align*}`, description: 'Aligned multiline equations without numbering.'
        },
        {
            label: 'gather', latex: String.raw`\begin{gather}
  a = b + c \\
  d = e + f
\end{gather}`, description: 'Stacked centered equations with numbering.'
        },
        {
            label: 'gather*', latex: String.raw`\begin{gather*}
  a = b + c \\
  d = e + f
\end{gather*}`, description: 'Stacked centered equations without numbering.'
        },
        {
            label: 'aligned (inline)', latex: String.raw`\begin{aligned}
  a &= b \\
  c &= d
\end{aligned}`, description: 'Aligned group for use inside math mode (no numbering).'
        },
        {
            label: 'split', latex: String.raw`\begin{split}
  a &= b + c + d \\
    &\quad + e + f
\end{split}`, description: 'Split a single equation across multiple aligned lines.'
        },
        {
            label: 'multline', latex: String.raw`\begin{multline}
  a + b + c + d + e + f \\
  + g + h + i
\end{multline}`, description: 'Break a long equation across multiple lines (first/last line aligned).'
        },
        {
            label: 'cases', latex: String.raw`\begin{cases}
  x, & \text{if } x > 0 \\
  0, & \text{otherwise}
\end{cases}`, description: 'Piecewise definition environment (cases with conditions).'
        }
    ]
};

export default equationEnvironmentsCategory;
