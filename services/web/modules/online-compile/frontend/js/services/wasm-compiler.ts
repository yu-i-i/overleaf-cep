/**
 * WASM Compiler Service
 *
 * Uses texlyre-busytex to compile LaTeX documents entirely in the browser
 * via WebAssembly. Supports PdfLaTeX, XeLaTeX, and LuaLaTeX engines.
 *
 * Font compatibility notes for pdflatex in the WASM bundle:
 * - EC/cm-super Type1 fonts (ecrm*.pfb) are NOT in the WASM asset bundle.
 *   These are required when \usepackage[T1]{fontenc} is used without lmodern.
 *   Without cm-super, pdflatex tries mktexpk → fork() → "Function not implemented".
 * - Latin Modern fonts (lmr*.pfb, lmss*.pfb etc.) ARE in the bundle.
 *   \usepackage{lmodern} plus \usepackage[T1]{fontenc} uses LM fonts and works.
 * - Classic OT1-encoded CM fonts (cmr10.pfb etc.) ARE in the bundle.
 *   Default encoding without fontenc works fine.
 * Fix: inject \usepackage[T1]{fontenc} + \usepackage{lmodern} for pdflatex
 * when lmodern is not already present in the document.
 */
import type { ProjectSnapshot } from '@/infrastructure/project-snapshot'

// Types matching the texlyre-busytex API
interface BusyTexConfig {
  busytexBasePath: string
  verbose: boolean
}

interface CompileOptions {
  input: string
  bibtex?: boolean
  verbose?: 'silent' | 'info' | 'debug'
  additionalFiles?: Array<{ path: string; content: string | Uint8Array }>
}

interface CompileResult {
  success: boolean
  pdf?: Uint8Array
  synctex?: Uint8Array
  log: string
  exitCode: number
  logs: any[]
}

// Dynamic import types - these will be loaded at runtime from the npm package
type BusyTexRunnerClass = new (config: BusyTexConfig) => BusyTexRunnerInstance
interface BusyTexRunnerInstance {
  initialize(useWorker?: boolean): Promise<void>
  isInitialized(): boolean
  terminate(): void
}

type CompilerClass = new (
  runner: BusyTexRunnerInstance,
  verbose?: boolean
) => CompilerInstance

interface CompilerInstance {
  compile(options: CompileOptions): Promise<CompileResult>
}

// Singleton runner instance
let runnerInstance: BusyTexRunnerInstance | null = null
let busytexModule: any = null
let initPromise: Promise<void> | null = null

/**
 * Get or initialize the BusyTexRunner singleton.
 * Uses a Web Worker for non-blocking compilation.
 */
async function getRunner(): Promise<BusyTexRunnerInstance> {
  if (runnerInstance?.isInitialized()) {
    return runnerInstance
  }

  if (initPromise) {
    await initPromise
    return runnerInstance!
  }

  initPromise = (async () => {
    // Dynamic import of texlyre-busytex
    busytexModule = await import('texlyre-busytex')
    const BusyTexRunner: BusyTexRunnerClass = busytexModule.BusyTexRunner

    runnerInstance = new BusyTexRunner({
      busytexBasePath: '/core/busytex',
      verbose: false,
    })

    // Initialize with Web Worker for non-blocking compilation
    await runnerInstance.initialize(true)
  })()

  await initPromise
  return runnerInstance!
}

/**
 * Map Overleaf compiler names to BusyTeX compiler classes.
 */
function getCompilerClass(compilerName?: string): string {
  switch (compilerName) {
    case 'xelatex':
      return 'XeLatex'
    case 'lualatex':
      return 'LuaLatex'
    case 'pdflatex':
    case 'latex':
    default:
      return 'PdfLatex'
  }
}

/**
 * Prepare LaTeX document content for browser WASM compilation.
 *
 * The WASM asset bundle includes Latin Modern Type1 fonts (lmr*.pfb, lmss*.pfb,
 * lmtt*.pfb, etc.) but does NOT include EC/cm-super Type1 fonts (ecrm*.pfb, ecss*.pfb,
 * etc.). EC fonts are the T1-encoded Computer Modern variants used when
 * \usepackage[T1]{fontenc} is combined with the default (non-LM) font setup.
 *
 * Without this injection, documents using T1 encoding trigger:
 *   kpathsea: Running mktexpk ... ecrm1000
 *   kpathsea: fork(): Function not implemented
 *   !pdfTeX error: Font ecrm1000 at 600 not found
 *   ==> Fatal error occurred, no output PDF file produced!
 *
 * This function injects \usepackage[T1]{fontenc} + \usepackage{lmodern} for pdflatex
 * documents that don't explicitly load lmodern, ensuring LM fonts are used instead
 * of the unavailable EC fonts. Latin Modern is the standard modern successor to
 * Computer Modern and is backward-compatible.
 *
 * XeLaTeX and LuaLaTeX use OpenType fonts natively and are not affected.
 */
function prepareForWasmCompile(content: string, compilerName?: string): string {
  // XeLaTeX and LuaLaTeX use OpenType fonts (fontspec); no pdflatex T1 fix needed.
  if (compilerName === 'xelatex' || compilerName === 'lualatex') {
    return content
  }

  // If lmodern is already loaded, the fonts are handled correctly.
  if (/\\usepackage\s*(?:\[.*?\]\s*)?\{lmodern\}/.test(content)) {
    return content
  }

  // Find the \documentclass declaration to insert after it.
  // Matches: \documentclass[options]{class} with optional whitespace and multiline options.
  const docClassMatch = content.match(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]+\}/)
  if (!docClassMatch) {
    return content
  }

  const insertPos = content.indexOf(docClassMatch[0]) + docClassMatch[0].length

  // Inject T1 encoding + lmodern.
  // - \usepackage[T1]{fontenc}: activates T1 (256-glyph) encoding; needed for proper
  //   hyphenation and glyph access in European languages.
  // - \usepackage{lmodern}: provides LM Type1 fonts for T1 encoding (lmr10.pfb etc.),
  //   replacing the unavailable EC/cm-super fonts. Also improves PDF quality overall.
  //
  // Note: if the document later loads \usepackage[T1]{fontenc} again, LaTeX silently
  // ignores the duplicate. If it loads a different encoding (e.g. OT1), that encoding
  // takes effect but lmodern still provides better font quality.
  const injection =
    '\n% [Online Compile] Auto-injected for browser/WASM compatibility:\n' +
    '% EC/cm-super fonts (T1-encoded CM) are unavailable in the WASM bundle.\n' +
    '% Latin Modern provides equivalent T1-encoded Type1 fonts (lmr10.pfb etc.).\n' +
    '\\usepackage[T1]{fontenc}\n' +
    '\\usepackage{lmodern}\n'

  return content.slice(0, insertPos) + injection + content.slice(insertPos)
}

/**
 * Extract the most informative error from a BusyTeX compile log.
 * Returns a user-friendly diagnostic string appended to the log.
 */
function buildErrorDiagnostic(log: string, exitCode: number): string {
  if (exitCode === 0) return log

  const lines: string[] = []

  // Detect EC/cm-super font errors (fork not implemented = mktexpk failed)
  if (
    /fork\(\).*Function not implemented/i.test(log) ||
    /mktexpk.*Function not implemented/i.test(log) ||
    /Font ec[a-z0-9]* at \d+ not found/i.test(log)
  ) {
    lines.push(
      '\n⚠ Browser Compile Diagnosis: Missing EC/cm-super font(s).',
      'The WASM bundle does not include EC Type1 fonts (cm-super package).',
      'These are needed when \\usepackage[T1]{fontenc} is used without lmodern.',
      'Fix: add \\usepackage{lmodern} to your preamble, or use the server compiler.'
    )
  } else if (/Font [a-z0-9]* at \d+ not found/i.test(log)) {
    // Generic font-not-found
    const match = log.match(/Font ([a-z0-9]+) at \d+ not found/i)
    const fontName = match ? match[1] : 'unknown'
    lines.push(
      `\n⚠ Browser Compile Diagnosis: Font "${fontName}" not found in WASM bundle.`,
      'This font may not be included in the WASM texlive bundle.',
      'Try using \\usepackage{lmodern} or switch to the server compiler.'
    )
  } else if (/LaTeX Error: File .* not found/i.test(log)) {
    const match = log.match(/LaTeX Error: File ['`]([^']+)' not found/i)
    const fileName = match ? match[1] : 'unknown'
    lines.push(
      `\n⚠ Browser Compile Diagnosis: Required file "${fileName}" not found.`,
      'The WASM bundle includes a subset of TeX Live (texlive-basic + texlive-extra).',
      'Some packages may not be available. Switch to the server compiler for full TeX Live.'
    )
  } else if (/Fatal error occurred/i.test(log)) {
    lines.push(
      '\n⚠ Browser Compile Diagnosis: pdflatex encountered a fatal error.',
      'Check the log above for the specific error (look for lines starting with !).',
      'Common causes: missing packages, font issues, or syntax errors.'
    )
  }

  return lines.length > 0 ? log + lines.join('\n') : log
}

/**
 * Gather all project files needed for compilation.
 *
 * Note on root document path: the BusyTeX pipeline always writes the root document as
 * "main.tex" in the WASM filesystem (hardcoded in BaseTool.getMainTexPath). Any other
 * project files are written under their original paths. This means:
 * - Root docs named "main.tex" at project root: work correctly.
 * - Root docs in subdirectories (e.g. "src/main.tex"): relative \input{} paths may not
 *   resolve correctly since the file is placed at the WASM FS root, not src/.
 * - Root docs with non-"main.tex" names: compiled as "main.tex"; any \input{} of the
 *   original filename (e.g. \input{thesis}) will not find it.
 * These are known limitations of the BusyTeX npm package's BaseTool implementation.
 */
async function gatherProjectFiles(
  projectSnapshot: ProjectSnapshot,
  rootDocPath: string,
  projectId: string
): Promise<{
  mainContent: string
  additionalFiles: Array<{ path: string; content: string | Uint8Array }>
  hasBibtex: boolean
  rootDocWarning?: string
}> {
  const additionalFiles: Array<{ path: string; content: string | Uint8Array }> =
    []
  let hasBibtex = false
  let rootDocWarning: string | undefined

  // Warn when the root doc is not "main.tex" at the project root, as relative
  // \input{} paths may break inside the WASM filesystem.
  if (rootDocPath !== 'main.tex') {
    rootDocWarning =
      `Note: root document is "${rootDocPath}" (not "main.tex"). ` +
      'In browser compilation, it is compiled as "main.tex" in the WASM filesystem. ' +
      'Relative \\input{} paths are resolved from the WASM root, not the original directory.'
  }

  // Collect all text files (.tex, .bib, .sty, .cls, .bst, etc.)
  const docPaths = projectSnapshot.getDocPaths()
  let mainContent = ''

  for (const docPath of docPaths) {
    const content = projectSnapshot.getDocContents(docPath)
    if (content == null) continue

    if (docPath === rootDocPath) {
      mainContent = content
    } else {
      additionalFiles.push({ path: docPath, content })
    }

    // Detect .bib files for bibtex support
    if (docPath.endsWith('.bib')) {
      hasBibtex = true
    }
  }

  // Also detect \bibliography or \addbibresource commands in the main content
  if (
    !hasBibtex &&
    (/\\bibliography\{/.test(mainContent) ||
      /\\addbibresource\{/.test(mainContent))
  ) {
    hasBibtex = true
  }

  // Collect binary files (images, fonts, etc.)
  const binaryFiles = projectSnapshot.getBinaryFilePathsWithHash()
  for (const { path, hash } of binaryFiles) {
    try {
      const response = await fetch(`/project/${projectId}/blob/${hash}`)
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer()
        additionalFiles.push({
          path,
          content: new Uint8Array(arrayBuffer),
        })
      }
    } catch (e) {
      console.warn(`Failed to fetch binary file ${path}:`, e)
    }
  }

  return { mainContent, additionalFiles, hasBibtex, rootDocWarning }
}

export interface OnlineCompileResult {
  success: boolean
  pdf?: Uint8Array
  synctex?: Uint8Array
  log: string
  exitCode: number
}

/**
 * Compile a LaTeX project in the browser using WASM.
 *
 * @param projectSnapshot - The project snapshot for file access
 * @param rootDocPath - Path to the root document (e.g. 'main.tex')
 * @param projectId - The project ID (for fetching binary files)
 * @param compilerName - The compiler to use ('pdflatex', 'xelatex', 'lualatex')
 * @returns Compile result with PDF data, log, and synctex
 */
export async function compileOnline(
  projectSnapshot: ProjectSnapshot,
  rootDocPath: string,
  projectId: string,
  compilerName?: string
): Promise<OnlineCompileResult> {
  // Initialize the WASM runner
  const runner = await getRunner()

  // Get the appropriate compiler class
  const compilerClassName = getCompilerClass(compilerName)
  const CompilerCls: CompilerClass = busytexModule[compilerClassName]
  const compiler = new CompilerCls(runner, false)

  // Gather all project files
  const { mainContent: rawMainContent, additionalFiles, hasBibtex, rootDocWarning } =
    await gatherProjectFiles(projectSnapshot, rootDocPath, projectId)

  if (!rawMainContent) {
    return {
      success: false,
      log: `Error: Root document "${rootDocPath}" not found or empty.`,
      exitCode: 1,
    }
  }

  // Prepare document content: inject LM fonts for pdflatex to handle T1 encoding
  // without requiring cm-super (EC Type1 fonts), which are absent from the WASM bundle.
  const mainContent = prepareForWasmCompile(rawMainContent, compilerName)

  // Build a preamble prefix for the log if we modified the document
  const wasModified = mainContent !== rawMainContent
  const modificationNote = wasModified
    ? '% [Online Compile] Injected \\usepackage[T1]{fontenc} + \\usepackage{lmodern}\n' +
    '% for browser WASM compatibility (EC fonts unavailable; LM fonts used instead).\n\n'
    : ''

  // Run compilation with verbose info mode to capture kpathsea font search diagnostics
  const result = await compiler.compile({
    input: mainContent,
    bibtex: hasBibtex,
    verbose: 'info',
    additionalFiles,
  })

  // Build the full log with diagnostics
  let log = modificationNote + (rootDocWarning ? `% Warning: ${rootDocWarning}\n\n` : '')
  log += buildErrorDiagnostic(result.log, result.exitCode)

  return {
    success: result.success,
    pdf: result.pdf,
    synctex: result.synctex,
    log,
    exitCode: result.exitCode,
  }
}

/**
 * Check if the WASM runtime is initialized.
 */
export function isWasmInitialized(): boolean {
  return runnerInstance?.isInitialized() ?? false
}

/**
 * Terminate the WASM runtime and clean up resources.
 */
export function terminateWasm(): void {
  if (runnerInstance) {
    runnerInstance.terminate()
    runnerInstance = null
    initPromise = null
  }
}
