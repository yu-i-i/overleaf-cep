import { describe, expect, it } from 'vitest'
import { analyzeProject } from '../../../app/src/analyzer/analyze-project.mjs'

function document(id, path, content) {
  return { id, path, content, revision: 1 }
}

function snapshot({ documents, files = [], entryPointIds }) {
  return {
    projectId: 'project-id',
    documents,
    files,
    binaryBibliographies: [],
    entryPointIds,
  }
}

function issueTypes(result) {
  return Object.values(result.issues.byId).map(issue => issue.type)
}

describe('project inspection analyzer', function () {
  it('builds the selected dependency scope and reports high-confidence issues', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\input{chapter}
\input{missing}
\begin{figure}
  \includegraphics{figures/used}
\end{figure}
\begin{table}
  \label{tab:not-referenced}
\end{table}
See \ref{fig:missing} and \cite{Used,MissingCitation}.`
          ),
          document(
            'chapter',
            'chapter.tex',
            String.raw`\bibliography{references}`
          ),
          document(
            'bib',
            'references.bib',
            String.raw`@article{Used, title={Used}}
@article{Unused, title={Unused}}
@article{Used, title={Duplicate}}`
          ),
          document('draft', 'draft.tex', 'Draft only.'),
        ],
        files: [
          { id: 'used-image', path: 'figures/used.png' },
          { id: 'old-image', path: 'figures/old.png' },
        ],
      })
    )

    const types = issueTypes(result)
    expect(types).toContain('missing-file')
    expect(types).toContain('missing-reference')
    expect(types).toContain('missing-citation')
    expect(types).toContain('duplicate-bibliography-key')
    expect(types).toContain('unused-bibliography-entry')
    expect(types).toContain('possibly-unused-file')
    expect(types).toContain('unreferenced-figure')
    expect(types).toContain('unreferenced-table')
    expect(types).toContain('unlabeled-figure')
    expect(result.graph.roots).toEqual(['file:main.tex'])
  })

  it('does not treat a standalone includegraphics command as an unlabeled figure', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\includegraphics{figures/logo}`
          ),
        ],
        files: [{ id: 'logo', path: 'figures/logo.png' }],
      })
    )

    expect(issueTypes(result)).not.toContain('unlabeled-figure')
  })

  it('builds semantic figure, table, and reference nodes', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['chapter'],
        documents: [
          document(
            'chapter',
            'chap4.tex',
            String.raw`\begin{figure}[H]
\centering
\includegraphics[width=\textwidth]{custom/offline-training.png}
\caption{Offline training}
\label{fig:offline-training-pipeline}
\end{figure}
\begin{table}[H]
\caption{Analyzer fields}
\label{tab:analyzer-log-fields}
\end{table}
See \ref{tab:analyzer-log-fields}.`
          ),
        ],
        files: [
          {
            id: 'offline-training',
            path: 'custom/offline-training.png',
          },
        ],
      })
    )

    const figure = result.graph.nodes.find(
      node =>
        node.kind === 'figure' &&
        node.label === 'fig:offline-training-pipeline'
    )
    const image = result.graph.nodes.find(
      node =>
        node.kind === 'figure-file' &&
        node.label === 'custom/offline-training.png'
    )
    const table = result.graph.nodes.find(
      node =>
        node.kind === 'table' &&
        node.label === 'tab:analyzer-log-fields'
    )
    const label = result.graph.nodes.find(
      node =>
        node.kind === 'label' &&
        node.label === 'tab:analyzer-log-fields'
    )
    const reference = result.graph.nodes.find(
      node =>
        node.kind === 'reference' &&
        node.label === 'chap4.tex:11'
    )

    expect(figure).toMatchObject({
      parentId: 'file:chap4.tex',
      location: { line: 1, column: 0, sourceText: String.raw`\begin{figure}` },
    })
    expect(image).toMatchObject({
      parentId: figure.id,
      path: 'custom/offline-training.png',
    })
    expect(image.location).toBeUndefined()
    expect(table).toMatchObject({
      parentId: 'file:chap4.tex',
      location: { line: 7, column: 0, sourceText: String.raw`\begin{table}` },
    })
    expect(label.location).toMatchObject({
      line: 9,
      column: 0,
      sourceText: String.raw`\label{tab:analyzer-log-fields}`,
    })
    expect(reference).toMatchObject({
      location: {
        line: 11,
        column: 4,
        sourceText: String.raw`\ref{tab:analyzer-log-fields}`,
      },
    })
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'references',
        from: label.id,
        to: reference.id,
      })
    )
  })

  it('groups repeated citations by source file and keeps exact occurrences', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\input{sections/relatedwork}
\bibliography{references}`
          ),
          document(
            'related',
            'sections/relatedwork.tex',
            String.raw`First \cite{li2026webspotter}.
Second \cite{other, li2026webspotter}.
Third \cite{li2026webspotter} and \cite{li2026webspotter}.`
          ),
          document(
            'bib',
            'references.bib',
            String.raw`@article{li2026webspotter, title={Web Spotter}}
@article{other, title={Other}}`
          ),
        ],
      })
    )

    const groups = result.graph.nodes.filter(
      node =>
        node.kind === 'citation' &&
        node.label === 'li2026webspotter' &&
        node.parentId === 'file:sections/relatedwork.tex'
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].location).toMatchObject({
      path: 'references.bib',
      line: 1,
      sourceText: 'li2026webspotter',
    })

    const occurrences = result.graph.nodes
      .filter(
        node =>
          node.kind === 'citation-occurrence' &&
          node.parentId === groups[0].id
      )
      .sort((left, right) => left.location.from - right.location.from)
    expect(occurrences.map(node => node.label)).toEqual([
      'sections/relatedwork.tex:1',
      'sections/relatedwork.tex:2',
      'sections/relatedwork.tex:3',
      'sections/relatedwork.tex:3',
    ])
    expect(occurrences.map(node => node.location.sourceText)).toEqual([
      'li2026webspotter',
      'li2026webspotter',
      'li2026webspotter',
      'li2026webspotter',
    ])
    expect(new Set(occurrences.map(node => node.location.from)).size).toBe(4)
    expect(result.overview.citationCount).toBe(5)
  })

  it('creates a separate citation group for each source file', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\input{a}
\input{b}
\bibliography{references}`
          ),
          document('a', 'a.tex', String.raw`\cite{shared}`),
          document('b', 'b.tex', String.raw`\cite{shared}`),
          document('bib', 'references.bib', String.raw`@article{shared}`),
        ],
      })
    )

    const groups = result.graph.nodes.filter(
      node => node.kind === 'citation' && node.label === 'shared'
    )
    expect(groups).toHaveLength(2)
    expect(groups.map(node => node.parentId).sort()).toEqual([
      'file:a.tex',
      'file:b.tex',
    ])
    expect(
      groups.map(group =>
        result.graph.nodes.filter(node => node.parentId === group.id).length
      )
    ).toEqual([1, 1])
  })

  it('groups missing citation occurrences into one issue', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\cite{missing}
\cite{missing}`
          ),
        ],
      })
    )

    const groups = result.graph.nodes.filter(
      node => node.kind === 'citation' && node.label === 'missing'
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      status: 'missing',
      location: {
        path: 'main.tex',
        line: 1,
        sourceText: 'missing',
      },
    })
    const occurrences = result.graph.nodes.filter(
      node => node.parentId === groups[0].id
    )
    expect(occurrences).toHaveLength(2)
    expect(occurrences.every(node => node.status === 'normal')).toBe(true)
    const issues = Object.values(result.issues.byId).filter(
      issue => issue.type === 'missing-citation'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].locations.map(location => location.line)).toEqual([1, 2])
    expect(result.views.missing).toEqual([issues[0].id])
    expect(result.overview.missing).toBe(1)
  })

  it('groups normalized missing targets across source files', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['first', 'second'],
        documents: [
          document(
            'first',
            'sections/first.tex',
            String.raw`\includegraphics{./missing.png}`
          ),
          document(
            'second',
            'chapters/second.tex',
            String.raw`\includegraphics{missing.png}`
          ),
        ],
      })
    )

    const issues = Object.values(result.issues.byId).filter(
      issue => issue.type === 'missing-figure'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].locations.map(location => location.path)).toEqual([
      'chapters/second.tex',
      'sections/first.tex',
    ])
    expect(issues[0].entryPoints.sort()).toEqual(['first', 'second'])
    expect(result.overview.missing).toBe(1)
  })

  it('groups unreferenced definitions by component identity', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\label{orphan}
\label{orphan}`
          ),
        ],
      })
    )

    const issues = Object.values(result.issues.byId).filter(
      issue => issue.type === 'unreferenced-label'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].locations.map(location => location.line)).toEqual([1, 2])
    expect(result.overview.unusedUnreferenced).toBe(1)
  })

  it('groups unused bibliography entries by key', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\bibliography{references}`
          ),
          document(
            'bib',
            'references.bib',
            String.raw`@article{orphan, title={First}}
@article{orphan, title={Second}}`
          ),
        ],
      })
    )

    const issues = Object.values(result.issues.byId).filter(
      issue => issue.type === 'unused-bibliography-entry'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].locations.map(location => location.line)).toEqual([1, 2])
    expect(result.overview.unusedUnreferenced).toBe(1)
  })

  it('groups duplicate components found through multiple entry points', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['first', 'second'],
        documents: [
          document(
            'first',
            'first.tex',
            String.raw`\label{shared}
\label{shared}`
          ),
          document(
            'second',
            'second.tex',
            String.raw`\label{shared}
\label{shared}`
          ),
        ],
      })
    )

    const issues = Object.values(result.issues.byId).filter(
      issue => issue.type === 'duplicate-label'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].locations).toHaveLength(4)
    expect(issues[0].entryPoints.sort()).toEqual(['first', 'second'])
    expect(result.overview.duplicate).toBe(1)
  })

  it('navigates a duplicate citation key to its first bibliography entry', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\cite{shared}
\bibliography{references}`
          ),
          document(
            'bib',
            'references.bib',
            String.raw`@article{shared, title={First}}
@article{shared, title={Second}}`
          ),
        ],
      })
    )

    const group = result.graph.nodes.find(
      node => node.kind === 'citation' && node.label === 'shared'
    )
    expect(group.location).toMatchObject({
      path: 'references.bib',
      line: 1,
      sourceText: 'shared',
    })
    expect(issueTypes(result)).toContain('duplicate-bibliography-key')
  })

  it('uses path and line fallbacks for unlabeled environments', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\begin{figure}
content
\end{figure}
\begin{table}
content
\end{table}`
          ),
        ],
      })
    )

    expect(result.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'figure',
          label: 'Figure main.tex:1',
        }),
        expect.objectContaining({
          kind: 'table',
          label: 'Table main.tex:4',
        }),
      ])
    )
  })

  it.each(['figure', 'figure*', 'table', 'table*', 'longtable'])(
    'warns when the %s environment has no label',
    environment => {
      const result = analyzeProject(
        snapshot({
          entryPointIds: ['main'],
          documents: [
            document(
              'main',
              'main.tex',
              `\\begin{${environment}}\ncontent\n\\end{${environment}}`
            ),
          ],
        })
      )

      expect(issueTypes(result)).toContain(
        environment.startsWith('figure')
          ? 'unlabeled-figure'
          : 'unlabeled-table'
      )
    }
  )

  it('calculates duplicate labels independently for each selected root', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['first', 'second'],
        documents: [
          document('first', 'first.tex', String.raw`\label{shared:name}`),
          document('second', 'second.tex', String.raw`\label{shared:name}`),
        ],
      })
    )

    expect(issueTypes(result)).not.toContain('duplicate-label')
  })

  it('includes a project-local document class and its internal input', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\documentclass[runningheads]{llncs}`
          ),
          document('class', 'llncs.cls', String.raw`\input{settings}`),
          document('settings', 'settings.def', 'settings'),
        ],
      })
    )

    const classCommand = result.graph.nodes.find(
      node => node.kind === 'include' && node.label === 'llncs'
    )
    const settingsCommand = result.graph.nodes.find(
      node => node.kind === 'include' && node.label === 'settings'
    )

    expect(classCommand).toMatchObject({
      parentId: 'file:main.tex',
      location: {
        path: 'main.tex',
        line: 1,
        sourceText: 'llncs',
      },
    })
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'include',
        from: classCommand.id,
        to: 'file:llncs.cls',
      })
    )
    expect(settingsCommand).toMatchObject({ parentId: 'file:llncs.cls' })
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'include',
        from: settingsCommand.id,
        to: 'file:settings.def',
      })
    )
    expect(result.overview.fileCount).toBe(3)
    expect(issueTypes(result)).not.toContain('possibly-unused-file')
  })

  it('keeps the existing tex priority for extensionless input', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document('main', 'main.tex', String.raw`\input{shared}`),
          document('tex', 'shared.tex', 'tex file'),
          document('def', 'shared.def', 'def file'),
        ],
      })
    )

    const input = result.graph.nodes.find(
      node => node.kind === 'include' && node.label === 'shared'
    )
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'include',
        from: input.id,
        to: 'file:shared.tex',
      })
    )
    expect(result.overview.fileCount).toBe(2)
  })

  it('ignores document classes that are not stored in the project', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document('main', 'main.tex', String.raw`\documentclass{article}`),
        ],
      })
    )

    expect(
      result.graph.nodes.some(
        node => node.kind === 'include' && node.label === 'article'
      )
    ).toBe(false)
    expect(issueTypes(result)).not.toContain('missing-file')
  })

  it('follows project-local LoadClass dependencies from class files', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document('main', 'main.tex', String.raw`\documentclass{custom}`),
          document(
            'custom',
            'custom.cls',
            String.raw`\LoadClassWithOptions{base}`
          ),
          document('base', 'base.cls', 'base class'),
        ],
      })
    )

    const loadClass = result.graph.nodes.find(
      node => node.kind === 'include' && node.label === 'base'
    )
    expect(loadClass).toMatchObject({ parentId: 'file:custom.cls' })
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'include',
        from: loadClass.id,
        to: 'file:base.cls',
      })
    )
    expect(result.overview.fileCount).toBe(3)
  })

  it('does not create dependencies for package-loading commands', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\usepackage{local}\RequirePackage{required}`
          ),
          document('local', 'local.sty', 'local package'),
          document('required', 'required.sty', 'required package'),
        ],
      })
    )

    expect(
      result.graph.nodes.some(
        node =>
          node.kind === 'include' &&
          ['local', 'required'].includes(node.label)
      )
    ).toBe(false)
    expect(result.overview.fileCount).toBe(1)
  })

  it('reports an include cycle without recursing indefinitely', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document('main', 'main.tex', String.raw`\input{chapter}`),
          document('chapter', 'chapter.tex', String.raw`\input{main}`),
        ],
      })
    )

    expect(result.overview.circular).toBe(1)
    const issue = Object.values(result.issues.byId).find(
      item => item.type === 'circular-dependency'
    )
    expect(issue.status).toBe('circular')
    expect(issue.cycleEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'main.tex',
          to: 'chapter.tex',
          location: expect.objectContaining({
            path: 'main.tex',
            line: 1,
            column: 7,
            sourceText: 'chapter',
          }),
        }),
        expect.objectContaining({
          from: 'chapter.tex',
          to: 'main.tex',
          location: expect.objectContaining({
            path: 'chapter.tex',
            line: 1,
            column: 7,
            sourceText: 'main',
          }),
        }),
      ])
    )
    expect(issue.title).toContain(' ↔ ')
  })

  it('reports each edge in a multi-file include cycle', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['a'],
        documents: [
          document('a', 'a.tex', String.raw`\input{b}`),
          document('b', 'b.tex', String.raw`\input{c}`),
          document('c', 'c.tex', String.raw`\input{a}`),
        ],
      })
    )

    const issue = Object.values(result.issues.byId).find(
      item => item.type === 'circular-dependency'
    )
    expect(issue.cycleEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'a.tex', to: 'b.tex' }),
        expect.objectContaining({ from: 'b.tex', to: 'c.tex' }),
        expect.objectContaining({ from: 'c.tex', to: 'a.tex' }),
      ])
    )
  })

  it('groups the same cycle found through multiple entry points', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['a', 'b'],
        documents: [
          document('a', 'a.tex', String.raw`\input{b}`),
          document('b', 'b.tex', String.raw`\input{a}`),
        ],
      })
    )

    const issues = Object.values(result.issues.byId).filter(
      issue => issue.type === 'circular-dependency'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].entryPoints.sort()).toEqual(['a', 'b'])
    expect(issues[0].cycleEdges).toHaveLength(2)
    expect(result.views.circular).toEqual([issues[0].id])
    expect(result.overview.circular).toBe(1)
  })

  it('reports the include location for a self-cycle', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document('main', 'main.tex', String.raw`\input{main}`),
        ],
      })
    )

    const issue = Object.values(result.issues.byId).find(
      item => item.type === 'circular-dependency'
    )
    expect(issue.cycleEdges).toEqual([
      {
        from: 'main.tex',
        to: 'main.tex',
        location: expect.objectContaining({
          path: 'main.tex',
          line: 1,
          column: 7,
          sourceText: 'main',
        }),
      },
    ])
  })

  it('reports bibliography entries with equivalent normalized titles', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\bibliography{references}`
          ),
          document(
            'bib',
            'references.bib',
            String.raw`@article{First, title={An {Overview}~of GPU}}
@book{Second, TITLE=" an overview" # " of gpu "}`
          ),
        ],
      })
    )

    const issues = Object.values(result.issues.byId).filter(
      item => item.type === 'duplicate-bibliography-title'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe(
      'Duplicate bibliography title: An Overview of GPU'
    )
    expect(issues[0].locations).toEqual([
      expect.objectContaining({
        path: 'references.bib',
        line: 1,
        sourceText: 'title={An {Overview}~of GPU}',
      }),
      expect.objectContaining({
        path: 'references.bib',
        line: 2,
        sourceText: 'TITLE=" an overview" # " of gpu "',
      }),
    ])
    expect(result.views.duplicate).toContain(issues[0].id)
  })

  it('does not report the same entries twice when key and title both match', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\bibliography{references}`
          ),
          document(
            'bib',
            'references.bib',
            String.raw`@article{Same, title={Same title}}
@book{Same, title={Same title}}`
          ),
        ],
      })
    )

    const duplicateTypes = result.views.duplicate.map(
      id => result.issues.byId[id].type
    )
    expect(duplicateTypes).toEqual(['duplicate-bibliography-key'])
  })

  it('skips dynamic titles and bibliography files outside the selected scope', function () {
    const result = analyzeProject(
      snapshot({
        entryPointIds: ['main'],
        documents: [
          document(
            'main',
            'main.tex',
            String.raw`\bibliography{references}`
          ),
          document(
            'bib',
            'references.bib',
            String.raw`@article{First, title=sharedTitle}
@book{Second, title=sharedTitle}
@misc{NoTitle}`
          ),
          document(
            'unused-bib',
            'unused.bib',
            String.raw`@article{OutsideA, title={Outside}}
@book{OutsideB, title={Outside}}`
          ),
        ],
      })
    )

    expect(issueTypes(result)).not.toContain('duplicate-bibliography-title')
  })
})
