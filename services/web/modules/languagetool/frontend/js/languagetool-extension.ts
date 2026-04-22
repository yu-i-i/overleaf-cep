/**
 * LanguageTool CodeMirror 6 extension.
 *
 * Exported as a named `extension` function matching the `sourceEditorExtensions`
 * module-import slot signature:  (options: Record<string, any>) => Extension
 *
 * Features:
 *  - Grammar and style linting via the /languagetool/check backend proxy
 *  - Uses a CUSTOM decoration + tooltip system instead of @codemirror/lint.
 *    The Overleaf compile-log linter globally combines markerFilter (only
 *    severity=error) and tooltipFilter (returns []) into the lint facet,
 *    which hides LT grammar warnings.  By managing our own StateField,
 *    Decoration layer, and hoverTooltip we bypass those filters entirely.
 *  - Debounced: checks 2 s after the last document change
 *  - LaTeX-aware: uses the Lezer syntax tree to identify plain-text regions;
 *    math, commands, comments, citation keys, labels, and package arguments
 *    are sent as `markup` in the LT annotation format
 *  - Falls back to regex-based parsing when the syntax tree is unavailable
 *  - Filters TYPOS category when the Overleaf Hunspell spellchecker is active
 *    to avoid duplicate underlines; tracks Hunspell state dynamically
 *  - Cancels stale HTTP requests with AbortController
 *  - Dynamic language: responds to `lt:settings-changed` window events
 *
 * All logic is self-contained — no imports from Overleaf core internals.
 */

import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  hoverTooltip,
  type ViewUpdate,
} from '@codemirror/view'
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import type { SyntaxNodeRef } from '@lezer/common'
import getMeta from '@/utils/meta'
import {
  latexToAnnotations,
  type LTAnnotation,
} from './utils/latex-to-annotations'

// ─── Persistence helpers ──────────────────────────────────────────────────────

function getStoredLanguage(projectId: string): string {
  return localStorage.getItem(`lt-language-${projectId}`) || 'auto'
}

function getStoredEnabled(projectId: string): boolean {
  return localStorage.getItem(`lt-enabled-${projectId}`) !== 'false'
}

// ─── LT types ─────────────────────────────────────────────────────────────────

interface LTMatch {
  offset: number
  length: number
  message: string
  rule?: { id?: string; category?: { id?: string } }
  replacements?: Array<{ value: string }>
}

/** Our own diagnostic type — independent of @codemirror/lint's Diagnostic. */
interface LTDiagnostic {
  from: number
  to: number
  severity: 'error' | 'warning'
  message: string
  source: string
  replacements: string[]
}

// ─── LaTeX node skip-list ─────────────────────────────────────────────────────
// Mirrors the `noSpellCheckProp` definitions in the Overleaf LaTeX grammar
// without importing the core module.  These argument node types contain
// non-prose content (citation keys, labels, package names, etc.) and must be
// skipped so that LanguageTool does not report false positives on them.

/** Node types whose entire subtree is always non-prose. */
const ALWAYS_SKIP = new Set([
  'BibKeyArgument',
  'BibliographyArgument',
  'BibliographyStyleArgument',
  'DocumentClassArgument',
  'LabelArgument',
  'PackageArgument',
  'RefArgument',
])

/** Node types to skip only when they appear inside certain parent contexts. */
const CONTEXTUAL_SKIP: Record<string, string[][]> = {
  OptionalArgument: [
    ['DocumentClass'],
    ['IncludeGraphics'],
    ['LineBreak'],
    ['UsePackage'],
    ['FigureEnvironment', 'BeginEnv'],
    ['ListEnvironment', 'BeginEnv'],
  ],
  ShortTextArgument: [['Date'], ['SetLengthCommand']],
  TextArgument: [['TabularEnvironment', 'BeginEnv']],
}

function shouldSkipNode(node: SyntaxNodeRef): boolean {
  if (ALWAYS_SKIP.has(node.type.name)) return true
  const contexts = CONTEXTUAL_SKIP[node.type.name]
  if (contexts) {
    return contexts.some(ctx => node.matchContext(ctx))
  }
  return false
}

// ─── Syntax-tree walker ───────────────────────────────────────────────────────

interface TextSpan {
  from: number
  to: number
  text: string
}

/**
 * Collect all "Normal" text spans from a single document line using the Lezer
 * syntax tree.  Nodes matching the skip-list above are pruned so their
 * children (including any nested Normal nodes) are never visited.
 */
function getNormalSpansFromLine(
  state: EditorState,
  lineFrom: number,
  lineTo: number
): TextSpan[] {
  const tree = syntaxTree(state)
  const spans: TextSpan[] = []

  tree.iterate({
    from: lineFrom,
    to: lineTo,
    enter(node: SyntaxNodeRef) {
      if (shouldSkipNode(node)) return false
      if (node.type.name === 'Normal') {
        spans.push({
          from: node.from,
          to: node.to,
          text: state.doc.sliceString(node.from, node.to),
        })
        return false
      }
      return true
    },
  })

  return spans
}

// ─── Annotation builder (syntax tree) ─────────────────────────────────────────

/**
 * Emit a gap (everything between two Normal text spans) as whitespace → text
 * (so LanguageTool sees sentence boundaries) and non-whitespace → markup.
 */
function emitGap(annotations: LTAnnotation[], gap: string): void {
  const segments = gap.match(/\s+|\S+/g)
  if (!segments) return
  for (const segment of segments) {
    if (/^\s+$/.test(segment)) {
      annotations.push({ text: segment })
    } else {
      annotations.push({ markup: segment })
    }
  }
}

/**
 * Build LT annotations from the Lezer syntax tree.  Only "Normal" text nodes
 * are emitted as checkable `text`; everything else becomes `markup`.
 *
 * Invariant: annotations.map(a => a.text ?? a.markup).join('') === source
 */
function buildAnnotationsFromTree(view: EditorView): LTAnnotation[] {
  const { state } = view
  const doc = state.doc
  const annotations: LTAnnotation[] = []
  let lastEnd = 0

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const spans = getNormalSpansFromLine(state, line.from, line.to)

    for (const span of spans) {
      if (span.from > lastEnd) {
        emitGap(annotations, doc.sliceString(lastEnd, span.from))
      }
      annotations.push({ text: span.text })
      lastEnd = span.to
    }
  }

  if (lastEnd < doc.length) {
    emitGap(annotations, doc.sliceString(lastEnd, doc.length))
  }

  return annotations
}

// ─── State management ─────────────────────────────────────────────────────────
//
// We deliberately do NOT use @codemirror/lint's `linter()` because its
// `lintConfig` facet is a global combine: the compile-log linter's
// `markerFilter` (only severity=error) and `tooltipFilter` (returns [])
// suppress our grammar-warning underlines and tooltips.  Instead we manage
// our own StateField → DecorationSet pipeline and a standalone hoverTooltip.

const setLTDiagnosticsEffect = StateEffect.define<readonly LTDiagnostic[]>()

const ltDiagnosticsField = StateField.define<{
  diagnostics: readonly LTDiagnostic[]
  decorations: DecorationSet
}>({
  create() {
    return { diagnostics: [], decorations: Decoration.none }
  },
  update({ diagnostics, decorations }, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLTDiagnosticsEffect)) {
        const diags = effect.value
        if (diags.length === 0) {
          return { diagnostics: [], decorations: Decoration.none }
        }
        const marks = diags
          .filter(d => d.from < d.to && d.to <= tr.state.doc.length)
          .map(d =>
            Decoration.mark({
              class: `cm-lt-underline cm-lt-underline-${d.severity}`,
            }).range(d.from, d.to)
          )
        return {
          diagnostics: diags,
          decorations: Decoration.set(marks, true),
        }
      }
    }
    if (tr.docChanged) {
      const mapped = diagnostics
        .map(d => ({
          ...d,
          from: tr.changes.mapPos(d.from, 1),
          to: tr.changes.mapPos(d.to, -1),
        }))
        .filter(d => d.from < d.to)
      return {
        diagnostics: mapped,
        decorations: decorations.map(tr.changes),
      }
    }
    return { diagnostics, decorations }
  },
  provide: f => EditorView.decorations.from(f, val => val.decorations),
})

// ─── Hover tooltip ────────────────────────────────────────────────────────────

const ltTooltip = hoverTooltip(
  (view, pos) => {
    const { diagnostics } = view.state.field(ltDiagnosticsField)
    const matches = diagnostics.filter(d => d.from <= pos && pos <= d.to)
    if (!matches.length) return null

    const primary = matches[0]
    return {
      pos: primary.from,
      end: primary.to,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-lt-tooltip'

        for (const match of matches) {
          const entry = document.createElement('div')
          entry.className = 'cm-lt-tooltip-entry'

          const msg = document.createElement('div')
          msg.className = 'cm-lt-tooltip-message'
          msg.textContent = match.message
          entry.appendChild(msg)

          if (match.source) {
            const src = document.createElement('div')
            src.className = 'cm-lt-tooltip-source'
            src.textContent = match.source
            entry.appendChild(src)
          }

          if (match.replacements.length) {
            const actions = document.createElement('div')
            actions.className = 'cm-lt-tooltip-actions'
            for (const rep of match.replacements) {
              const btn = document.createElement('button')
              btn.className = 'cm-lt-tooltip-action'
              btn.textContent = rep
              btn.addEventListener('click', e => {
                e.preventDefault()
                view.dispatch({
                  changes: { from: match.from, to: match.to, insert: rep },
                })
              })
              actions.appendChild(btn)
            }
            entry.appendChild(actions)
          }

          dom.appendChild(entry)
        }

        return { dom }
      },
    }
  },
  { hoverTime: 300 }
)

// ─── Theme ────────────────────────────────────────────────────────────────────

const ltTheme = EditorView.baseTheme({
  '.cm-lt-underline': {
    backgroundImage: 'none !important',
    textDecoration: 'underline wavy',
    textUnderlineOffset: '3px',
  },
  '.cm-lt-underline-warning': {
    textDecorationColor: '#E8A200',
  },
  '.cm-lt-underline-error': {
    textDecorationColor: '#d11',
  },
  '.cm-lt-tooltip': {
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '4px',
    padding: '8px',
    fontSize: '13px',
    maxWidth: '400px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  '.cm-lt-tooltip-entry + .cm-lt-tooltip-entry': {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid #eee',
  },
  '.cm-lt-tooltip-message': {
    marginBottom: '4px',
  },
  '.cm-lt-tooltip-source': {
    fontSize: '11px',
    color: '#888',
    marginBottom: '4px',
  },
  '.cm-lt-tooltip-actions': {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  '.cm-lt-tooltip-action': {
    padding: '2px 8px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
    fontSize: '12px',
    '&:hover': {
      backgroundColor: '#e0e0e0',
    },
  },
})

// ─── Module export ────────────────────────────────────────────────────────────

export const extension = (options: Record<string, any>): Extension => {
  const projectId = getMeta('ol-project_id') ?? ''

  /**
   * ViewPlugin that manages the full lifecycle:
   *  1. On mount — checks /languagetool/status and enables checking if LT
   *     is available and the user has it enabled for this project.
   *  2. On document changes — debounces a new check (2 s after last edit).
   *  3. Listens to `lt:settings-changed` window events for language/enable
   *     changes dispatched by the settings React component.
   *  4. Tracks Hunspell state dynamically via duck-typing on
   *     setSpellCheckLanguageEffect payloads.
   *  5. Dispatches setLTDiagnosticsEffect to update the StateField, which
   *     in turn drives the decoration layer and hover tooltip.
   */
  const syncPlugin = ViewPlugin.define(view => {
    let ltServerAvailable = false
    let hunspellActive = !!options?.spelling?.spellCheckLanguage
    let currentLanguage = getStoredLanguage(projectId)
    let enabled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null

    // ── Scheduling ──────────────────────────────────────────────────────

    function scheduleCheck(delay = 2000) {
      if (timer) clearTimeout(timer)
      if (!enabled) return
      timer = setTimeout(() => runCheck(), delay)
    }

    // ── Core check logic ────────────────────────────────────────────────

    async function runCheck() {
      if (!enabled) return

      // Abort any in-flight request.
      if (controller) controller.abort()
      const ac = new AbortController()
      controller = ac

      const source = view.state.doc.toString()
      if (source.trim().length < 20) {
        if (!ac.signal.aborted) {
          view.dispatch({ effects: setLTDiagnosticsEffect.of([]) })
        }
        return
      }

      // Prefer the Lezer syntax tree; fall back to regex-based parser.
      let annotations: LTAnnotation[]
      const tree = ensureSyntaxTree(view.state, view.state.doc.length, 500)
      if (tree) {
        annotations = buildAnnotationsFromTree(view)
      } else {
        annotations = latexToAnnotations(source)
      }

      try {
        const response = await fetch('/languagetool/check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Csrf-Token': getMeta('ol-csrfToken'),
          },
          body: JSON.stringify({
            language: currentLanguage,
            data: { annotation: annotations },
          }),
          signal: ac.signal,
        })

        if (!response.ok) return

        const result: { matches: LTMatch[] } = await response.json()

        // Filter TYPOS when Hunspell is active (it handles typos better).
        let matches = result.matches
        if (hunspellActive) {
          matches = matches.filter(m => m.rule?.category?.id !== 'TYPOS')
        }

        const docLen = view.state.doc.length
        const diagnostics: LTDiagnostic[] = matches
          .filter(m => m.offset >= 0 && m.offset + m.length <= docLen)
          .map(m => ({
            from: m.offset,
            to: m.offset + m.length,
            severity:
              m.rule?.category?.id === 'TYPOS'
                ? ('error' as const)
                : ('warning' as const),
            message: m.message,
            source: `LanguageTool (${m.rule?.id ?? ''})`,
            replacements: (m.replacements ?? []).slice(0, 5).map(r => r.value),
          }))

        if (!ac.signal.aborted) {
          view.dispatch({ effects: setLTDiagnosticsEffect.of(diagnostics) })
        }
      } catch {
        // AbortError or network failure — silently ignore.
      }
    }

    // ── Initialisation ──────────────────────────────────────────────────

    fetch('/languagetool/status')
      .then(r => r.json())
      .then(({ enabled: serverEnabled }: { enabled: boolean }) => {
        ltServerAvailable = serverEnabled
        if (serverEnabled && getStoredEnabled(projectId)) {
          enabled = true
          scheduleCheck(500)
        }
      })
      .catch(() => {
        // LT service unreachable — leave disabled.
      })

    // ── Settings-changed listener ───────────────────────────────────────

    const handler = (event: Event) => {
      if (!ltServerAvailable) return

      const detail = (
        event as CustomEvent<{ language?: string; enabled?: boolean }>
      ).detail

      if (detail.language !== undefined) {
        currentLanguage = detail.language
      }
      const isEnabled =
        (detail.enabled ?? getStoredEnabled(projectId)) && ltServerAvailable

      if (isEnabled !== enabled || detail.language !== undefined) {
        enabled = isEnabled
        if (enabled) {
          scheduleCheck(100)
        } else {
          if (timer) clearTimeout(timer)
          if (controller) controller.abort()
          view.dispatch({ effects: setLTDiagnosticsEffect.of([]) })
        }
      }
    }

    window.addEventListener('lt:settings-changed', handler)

    // ── ViewPlugin callbacks ────────────────────────────────────────────

    return {
      update(update: ViewUpdate) {
        if (update.docChanged && enabled) {
          // Abort stale in-flight request and schedule a fresh check.
          if (controller) controller.abort()
          scheduleCheck()
        }

        // Track Hunspell state changes (duck-typed from effects).
        for (const tr of update.transactions) {
          for (const effect of tr.effects) {
            const val = effect.value as Record<string, unknown> | null
            if (
              val !== null &&
              typeof val === 'object' &&
              'spellCheckLanguage' in val
            ) {
              const newActive = !!(val.spellCheckLanguage as string)
              if (newActive !== hunspellActive) {
                hunspellActive = newActive
                if (enabled) scheduleCheck(100)
              }
            }
          }
        }
      },

      destroy() {
        window.removeEventListener('lt:settings-changed', handler)
        if (timer) clearTimeout(timer)
        if (controller) {
          controller.abort()
          controller = null
        }
      },
    }
  })

  return [ltDiagnosticsField, ltTooltip, ltTheme, syncPlugin]
}
