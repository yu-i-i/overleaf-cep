import React, { FC, useMemo } from 'react'
import { latexCommands, environmentTemplates, matrixTemplates } from '../data/latex-commands.mjs'

type Props = {
    searchQuery: string
    onSearchChange: (q: string) => void
    onInsertTemplate: (latex: string) => void
    onInsertCommand: (latex: string) => void
}

type CommandResult = {
    cmd: string
    desc: string
    insert?: string
}

export const TemplatesSidebar: FC<Props> = ({
    searchQuery,
    onSearchChange,
    onInsertTemplate,
    onInsertCommand,
}) => {
    // Search across all 800+ MathLive commands
    const searchResults = useMemo<CommandResult[]>(() => {
        const q = searchQuery.trim().toLowerCase()
        if (!q) return []
        const results: CommandResult[] = []
        for (const entry of latexCommands) {
            if (
                entry.cmd.toLowerCase().includes(q) ||
                entry.desc.toLowerCase().includes(q)
            ) {
                results.push(entry)
            }
            if (results.length >= 50) break // cap results for performance
        }
        return results
    }, [searchQuery])

    const showSearch = searchQuery.trim().length > 0

    return (
        <div className="latex-editor-sidebar">
            <div className="latex-editor-sidebar-search">
                <div className="latex-editor-search-wrapper">
                    <span className="latex-editor-search-icon" aria-hidden="true">
                        🔍
                    </span>
                    <input
                        type="search"
                        className="latex-editor-search-input"
                        placeholder="Search commands…"
                        value={searchQuery}
                        onChange={e => onSearchChange(e.target.value)}
                        aria-label="Search LaTeX commands"
                    />
                </div>
            </div>

            <div className="latex-editor-sidebar-scroll">
                {showSearch ? (
                    <>
                        <div className="latex-editor-sidebar-title">Results</div>
                        {searchResults.length === 0 && (
                            <div className="latex-editor-no-results">No commands found</div>
                        )}
                        {searchResults.map((r, i) => (
                            <button
                                key={`${r.cmd}-${i}`}
                                type="button"
                                className="latex-editor-template-btn"
                                title={r.desc}
                                onClick={() => onInsertCommand(r.insert ?? r.cmd)}
                            >
                                <code className="latex-editor-cmd-code">{r.cmd}</code>
                                <span className="latex-editor-cmd-desc">{r.desc}</span>
                            </button>
                        ))}
                    </>
                ) : (
                    <>
                        <div className="latex-editor-sidebar-title">Environments</div>
                        {environmentTemplates.map(t => (
                            <button
                                key={t.name}
                                type="button"
                                className="latex-editor-template-btn"
                                title={t.desc}
                                onClick={() => onInsertTemplate(t.latex)}
                            >
                                <span className="latex-editor-template-icon">{t.icon}</span>
                                {t.name}
                            </button>
                        ))}

                        <div className="latex-editor-sidebar-title">Matrices</div>
                        {matrixTemplates.map(t => (
                            <button
                                key={t.name}
                                type="button"
                                className="latex-editor-template-btn"
                                title={t.desc}
                                onClick={() => onInsertTemplate(t.latex)}
                            >
                                <span className="latex-editor-template-icon">{t.icon}</span>
                                {t.name}
                            </button>
                        ))}
                    </>
                )}
            </div>
        </div>
    )
}

export default TemplatesSidebar
