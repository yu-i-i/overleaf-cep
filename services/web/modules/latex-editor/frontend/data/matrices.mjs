export const matricesCategory = {
    name: 'Matrices',
    label: 'Matrices',
    symbols: [
        {
            label: 'matrix',
            latex: String.raw`\begin{matrix} a & b \\ c & d \end{matrix}`,
            previewLatex: String.raw`\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}`,
            description: 'Matrix (no delimiters) — basic matrix environment without surrounding delimiters.'
        },
        {
            label: '(matrix)',
            latex: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
            previewLatex: String.raw`\left(\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right)`,
            description: 'Parenthesized matrix — matrix enclosed in parentheses (pmatrix).'
        },
        {
            label: '[matrix]',
            latex: String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`,
            previewLatex: String.raw`\left[\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right]`,
            description: 'Bracketed matrix — matrix enclosed in square brackets (bmatrix).'
        },
        {
            label: '|matrix|',
            latex: String.raw`\begin{vmatrix} a & b \\ c & d \end{vmatrix}`,
            previewLatex: String.raw`\left|\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right|`,
            description: 'Determinant (vertical bars) — matrix enclosed in single vertical bars, often used for determinants.'
        },
        {
            label: '‖matrix‖',
            latex: String.raw`\begin{Vmatrix} a & b \\ c & d \end{Vmatrix}`,
            previewLatex: String.raw`\left\|\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right\|`,
            description: 'Double-vertical-bar matrix — used for norms or double-bar delimiters.'
        },
        {
            label: '{matrix}',
            latex: String.raw`\begin{Bmatrix} a & b \\ c & d \end{Bmatrix}`,
            previewLatex: String.raw`\left\{\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right\}`,
            description: 'Curly-braced matrix — matrix enclosed in curly braces (Bmatrix).'
        },
        {
            label: 'smallmatrix',
            latex: String.raw`\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}`,
            previewLatex: String.raw`\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}`,
            description: 'Inline small matrix — compact matrix for use inside text.'
        },
        {
            label: 'pmatrix',
            latex: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
            previewLatex: String.raw`\left(\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right)`,
            description: 'Example pmatrix — 2×2 matrix with parentheses.'
        },
        {
            label: 'bmatrix',
            latex: String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`,
            previewLatex: String.raw`\left[\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right]`,
            description: 'Example bmatrix — 2×2 matrix with square brackets.'
        },
        {
            label: 'determinant',
            latex: String.raw`\det\\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
            previewLatex: String.raw`\det\left(\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right)`,
            description: "Determinant — scalar value computed from a square matrix representing volume scaling of the corresponding linear map."
        }
    ]
};

export default matricesCategory;
