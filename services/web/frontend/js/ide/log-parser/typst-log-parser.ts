/**
 * Parser for Typst compiler output logs.
 *
 * Typst error format examples:
 *   error: the character `#` is not valid in code
 *     ┌─ main.typ:3:5
 *     │
 *   3 │ foo #bar
 *     │     ^ not valid here
 *     │
 *     = hint: if you meant to write a hashtag, escape it with a backslash: `\#`
 *
 *   warning: unknown variable: foo
 *     ┌─ main.typ:10:1
 *
 * Simpler single-line format (from stderr redirect):
 *   error: file not found (searched at main.typ)
 *   ./main.typ:3:10: error: unexpected token
 */

import { LatexLogEntry, ParseResult } from './latex-log-parser'

// Matches: "error: message" or "warning: message"
const TYPST_DIAGNOSTIC_REGEX = /^(error|warning):\s*(.+)$/
// Matches: "  ┌─ file.typ:line:col"
const TYPST_LOCATION_REGEX = /^\s*┌─\s*(.+?):(\d+):(\d+)\s*$/
// Matches: "  = hint: message"
const TYPST_HINT_REGEX = /^\s*=\s*hint:\s*(.+)$/
// Matches: "./file.typ:line:col: error: message" (file-line format from stderr)
const TYPST_FILE_LINE_REGEX = /^\.?\/?(.*):(\d+):(\d+):\s*(error|warning):\s*(.+)$/
// Matches: "typst 0.13.1" or "typst typst 0.13.1 (abcdef)"
const TYPST_VERSION_REGEX = /^typst\s+(?:typst\s+)?(\d+\.\d+\.\d+)/

export function parseTypstLog(rawLog: string): ParseResult {
    const entries: LatexLogEntry[] = []
    const typesetting: LatexLogEntry[] = []
    const lines = rawLog.split('\n')

    let i = 0
    while (i < lines.length) {
        const line = lines[i]

        // Extract version info
        const versionMatch = line.match(TYPST_VERSION_REGEX)
        if (versionMatch) {
            typesetting.push({
                file: undefined,
                line: null,
                level: 'typesetting',
                message: `Typst ${versionMatch[1]}`,
                content: '',
                raw: line,
            })
            i++
            continue
        }

        // Try file:line:col: level: message format first
        const fileLineMatch = line.match(TYPST_FILE_LINE_REGEX)
        if (fileLineMatch) {
            const entry: LatexLogEntry = {
                file: fileLineMatch[1],
                line: parseInt(fileLineMatch[2], 10),
                level: fileLineMatch[4] === 'error' ? 'error' : 'warning',
                message: fileLineMatch[5],
                content: '',
                raw: line,
            }

            // Collect hints following this entry
            i++
            while (i < lines.length) {
                const hintMatch = lines[i].match(TYPST_HINT_REGEX)
                if (hintMatch) {
                    entry.content += (entry.content ? '\n' : '') + 'hint: ' + hintMatch[1]
                    entry.raw += '\n' + lines[i]
                    i++
                } else {
                    break
                }
            }

            entries.push(entry)
            continue
        }

        // Try "error: message" / "warning: message" format
        const diagMatch = line.match(TYPST_DIAGNOSTIC_REGEX)
        if (diagMatch) {
            const entry: LatexLogEntry = {
                file: undefined,
                line: null,
                level: diagMatch[1] === 'error' ? 'error' : 'warning',
                message: diagMatch[2],
                content: '',
                raw: line,
            }

            // Look ahead for location and hints
            i++
            while (i < lines.length) {
                const locMatch = lines[i].match(TYPST_LOCATION_REGEX)
                if (locMatch) {
                    entry.file = locMatch[1]
                    entry.line = parseInt(locMatch[2], 10)
                    entry.raw += '\n' + lines[i]
                    i++
                    continue
                }

                const hintMatch = lines[i].match(TYPST_HINT_REGEX)
                if (hintMatch) {
                    entry.content += (entry.content ? '\n' : '') + 'hint: ' + hintMatch[1]
                    entry.raw += '\n' + lines[i]
                    i++
                    continue
                }

                // Continuation lines (code snippets, pipes, etc.) — part of the diagnostic block
                if (
                    lines[i].match(/^\s*│/) ||
                    lines[i].match(/^\s*$/) ||
                    lines[i].match(/^\s*┌/) ||
                    lines[i].match(/^\s*└/)
                ) {
                    entry.raw += '\n' + lines[i]
                    i++
                    continue
                }

                // Not part of this diagnostic anymore
                break
            }

            entries.push(entry)
            continue
        }

        i++
    }

    const errors = entries.filter(e => e.level === 'error')
    const warnings = entries.filter(e => e.level === 'warning')

    return {
        all: entries,
        errors,
        warnings,
        typesetting,
        files: [],
    }
}

/**
 * Returns true if the log content looks like Typst output
 * rather than LaTeX output.
 */
export function isTypstLog(rawLog: string): boolean {
    // Typst logs contain specific patterns
    if (TYPST_VERSION_REGEX.test(rawLog)) return true
    if (TYPST_DIAGNOSTIC_REGEX.test(rawLog)) return true
    if (TYPST_FILE_LINE_REGEX.test(rawLog)) return true
    // Check for the box-drawing location pattern
    if (/┌─.*\.typ:\d+:\d+/.test(rawLog)) return true
    return false
}
