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
