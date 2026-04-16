# Online Compile Module

Browser-based LaTeX compilation using WebAssembly, powered by [TeXlyre BusyTeX](https://github.com/TeXlyre/texlyre-busytex).

## Overview

This module adds an "Online Compile" option to Overleaf that compiles LaTeX documents entirely in the user's browser via WebAssembly, without using the CLSI server. This is useful for:

- Reducing server load
- Enabling offline-capable compilation
- Faster iteration for simple documents

## Supported Engines

- **PdfLaTeX** (PdfTeX + BibTeX8)
- **XeLaTeX** (XeTeX + BibTeX8 + dvipdfmx)
- **LuaLaTeX** (LuaHBTeX + BibTeX8)

## How It Works

1. User toggles "Online [browser]" in the Compile Target dropdown menu
2. When compiling, the module:
   - Gathers all project files (text and binary) from the project snapshot
   - Sends them to the BusyTeX WASM runtime running in a Web Worker
   - Receives the compiled PDF as a Uint8Array
   - Creates a blob URL and displays it in the existing PDF viewer
3. SyncTeX output is also generated for editor synchronization
4. Word count automatically uses client-side counting when online compile is active

## Setup

### Download WASM Assets

The WASM assets (~175MB) must be downloaded before building:

```bash
cd services/web
npx texlyre-busytex download-assets ./public/core
```

> Note: this module currently depends on `texlyre-busytex@^0.1.4-alpha`, which has an available BusyTeX release asset archive for `assets-v0.1.4-alpha`.

Or use the module script:

```bash
bash modules/online-compile/scripts/download-assets.sh
```

### Docker Build

The Dockerfile automatically downloads assets during the build process.

## Module Structure

```
online-compile/
├── index.mjs                           # Module entry point
├── README.md                           # This file
├── scripts/
│   └── download-assets.sh              # WASM asset download script
└── frontend/
    └── js/
        ├── online-compile-handler.ts   # Compile handler (registered via overleafModuleImports)
        └── services/
            └── wasm-compiler.ts        # WASM compile service using texlyre-busytex
```

## Core Changes

Minimal changes to core files:

- **`settings.defaults.js`** — Module registration + `onlineCompileHandler` import slot + CSP rules
- **`local-compile-context.tsx`** — `onlineCompile` state + delegation to WASM handler
- **`detach-compile-context.tsx`** — Forward `onlineCompile` state for detached windows
- **`pdf-compile-button.tsx`** — "Compile target" toggle (Server / Online)
- **`word-count-modal-content.tsx`** — Force client-side word count when online compile active
- **`output-files.ts`** — Handle blob URLs in PDF URL building
- **`nginx/overleaf.conf.template`** — Serve WASM assets with proper MIME types
- **`Dockerfile`** — Download WASM assets during build

## Limitations

- No `shell-escape` support (WASM sandbox restriction)
- Some fonts may not be available
- Large projects with many binary files may be slow to compile (files are fetched to browser)
- Packages beyond the bundled TeX Live 2025 base are not available
