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

## bibtex-tidy version pin — RUNTIME REQUIREMENT (verified 2026-08-31)

`bibtex-tidy` is pinned to **1.14.0** (the last release compatible with our
Node runtime) because **1.15.0 and 1.15.1 (latest, published ~3 weeks before
this note) call `Map.prototype.getOrInsert()`** — the TC39 "Upsert" proposal
method, stable and unflagged only in **Node.js 26+ (V8 14.6, ~May 2026)**.
Our runtime is Node 22 (web service + web build image), where the method
does not exist, so `tidy()` crashes on **every** call:

```
$ node --version                 # v22.21.1
$ node -e "console.log(typeof Map.prototype.getOrInsert)"    # undefined
$ npm i bibtex-tidy@1.15.1 && node -e "require('bibtex-tidy').tidy('@ARTICLE{s, author={A, B}, title={T}, year={2020},}', {curly:true})"
TypeError: seenFieldsByEntry.getOrInsert is not a function
```

Same crash on 1.15.0; verified in a clean directory (no other packages).
1.14.0 passes the same call on Node 22 and inside this monorepo.

**Rule:** keep the 1.14.0 pin until this project moves to Node 26+; only
then bump bibtex-tidy to 1.15.x and re-run
`test/unit/src/tex-autoformatter.test.mjs`.
