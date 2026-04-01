import React, { FC, useRef, useCallback } from 'react'

type SymbolCategory = {
    name: string
    label: string
    symbols: Array<{ label: string; latex: string; description: string }>
}

type SymbolItem = {
    label: string
    latex: string
    description: string
}

type Props = {
    primaryCategories: SymbolCategory[]
    secondaryCategories: SymbolCategory[]
    activeCategory: SymbolCategory
    onCategoryChange: (cat: SymbolCategory) => void
    searchQuery: string
    onSearchChange: (q: string) => void
    searchResults: SymbolItem[] | null
    onSymbolClick: (latex: string) => void
}

export const SymbolPalette: FC<Props> = ({
    primaryCategories,
    secondaryCategories,
    activeCategory,
    onCategoryChange,
    searchQuery,
    onSearchChange,
    searchResults,
    onSymbolClick,
}) => {
    const [showMore, setShowMore] = React.useState(false)
    const groupsRef = useRef<HTMLDivElement>(null)

    const handleKeyNavigation = useCallback(
        (e: React.KeyboardEvent, items: SymbolCategory[], index: number) => {
            const cols = 2
            let targetIdx: number | null = null
            switch (e.key) {
                case 'ArrowDown':
                    targetIdx = index + cols
                    break
                case 'ArrowUp':
                    targetIdx = index - cols
                    break
                case 'ArrowRight':
                    targetIdx = index + 1
                    break
                case 'ArrowLeft':
                    targetIdx = index - 1
                    break
                case 'Home':
                    targetIdx = 0
                    break
                case 'End':
                    targetIdx = items.length - 1
                    break
            }
            if (targetIdx !== null) {
                e.preventDefault()
                targetIdx = Math.max(0, Math.min(targetIdx, items.length - 1))
                const buttons = groupsRef.current?.querySelectorAll<HTMLButtonElement>(
                    '.latex-symbol-group-button'
                )
                buttons?.[targetIdx]?.focus()
            }
        },
        []
    )

    const allNavCategories = showMore
        ? [...primaryCategories, ...secondaryCategories]
        : primaryCategories

    const symbolsToDisplay = searchResults ?? activeCategory?.symbols ?? []

    return (
        <div className="latex-editor-nav">
            <div className="latex-symbol-search">
                <input
                    type="search"
                    className="latex-symbol-search-input"
                    placeholder="Search symbols…"
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    aria-label="Search symbols"
                />
            </div>

            <div
                className="latex-symbol-groups"
                role="tablist"
                ref={groupsRef}
            >
                {allNavCategories.map((cat, i) => (
                    <button
                        key={cat.name}
                        type="button"
                        role="tab"
                        className={`latex-symbol-group-button${activeCategory.name === cat.name ? ' active' : ''
                            }`}
                        aria-selected={activeCategory.name === cat.name}
                        tabIndex={activeCategory.name === cat.name ? 0 : -1}
                        onClick={() => {
                            onCategoryChange(cat)
                            onSearchChange('')
                        }}
                        onKeyDown={e => handleKeyNavigation(e, allNavCategories, i)}
                        title={cat.name}
                    >
                        <span className="latex-symbol-group-label">{cat.label}</span>
                        <span className="latex-symbol-group-name">{cat.name}</span>
                    </button>
                ))}

                {!showMore && secondaryCategories.length > 0 && (
                    <button
                        type="button"
                        className="latex-symbol-group-button latex-symbol-more-button"
                        onClick={() => setShowMore(true)}
                    >
                        More…
                    </button>
                )}
                {showMore && (
                    <button
                        type="button"
                        className="latex-symbol-group-button latex-symbol-more-button"
                        onClick={() => setShowMore(false)}
                    >
                        Less
                    </button>
                )}
            </div>

            <div className="latex-symbol-panel" role="tabpanel">
                <div className="latex-symbol-grid">
                    {symbolsToDisplay.map((sym, i) => (
                        <button
                            key={`${sym.latex}-${i}`}
                            type="button"
                            className="latex-symbol-button"
                            title={`${sym.description}\n${sym.latex}`}
                            aria-label={sym.description}
                            onClick={() => onSymbolClick(sym.latex)}
                        >
                            {sym.label}
                        </button>
                    ))}
                    {symbolsToDisplay.length === 0 && (
                        <div className="latex-symbol-empty">
                            {searchQuery ? 'No symbols found' : 'Select a category'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default SymbolPalette
