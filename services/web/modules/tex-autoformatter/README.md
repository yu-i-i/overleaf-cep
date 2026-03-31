# tex-autoformatter

Idea for this feature was taken from https://github.com/TeXlyre/texlyre 

Overleaf module that adds a toolbar button to auto-format LaTeX and BibTeX files
using [tex-fmt](https://github.com/WGUNDERWOOD/tex-fmt) for `.tex`/`.cls`/`.sty`
files and [bibtex-tidy](https://github.com/FlamingTempura/bibtex-tidy) for `.bib`
files.

## Prerequisites

The `tex-fmt` binary must be available on `$PATH` in the server environment.
`bibtex-tidy` is installed as an npm dependency — no separate binary needed.

### Install tex-fmt via Cargo

```sh
cargo install tex-fmt
```

### Install tex-fmt via package manager (Debian trixie+)

```sh
apt install tex-fmt
```

### Install tex-fmt via binary download

Download from [GitHub releases](https://github.com/WGUNDERWOOD/tex-fmt/releases)
and place on `$PATH`.

## How it works

- **Backend**: Registers `POST /api/format-tex` which detects the file type from
  the filename extension. For `.bib` files it uses bibtex-tidy (Node.js API);
  for all other files it pipes content through `tex-fmt --stdin`.
- **Frontend**: Adds an auto-format button (magic wand icon) to the CodeMirror
  toolbar. Clicking it sends the current document and its filename to the backend
  and replaces the editor content with the formatted output.

## License

This module is part of the Overleaf project.

tex-fmt is licensed under the MIT License — see [LICENSE-tex-fmt](LICENSE-tex-fmt).
bibtex-tidy is licensed under the MIT License — see [LICENSE-bibtex-tidy](LICENSE-bibtex-tidy).
