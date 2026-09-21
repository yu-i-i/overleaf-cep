import path from 'node:path'
import { extractLatex } from './latex-extractor.mjs'
import { extractBibtex } from './bibtex-extractor.mjs'
import { resolveProjectPath } from './resource-resolver.mjs'
import { findCycles } from './cycles.mjs'
import { GraphBuilder } from './graph-builder.mjs'
import { IssueCollector } from './issue-collector.mjs'

const TEX_EXTENSIONS = new Set([
  '.tex',
  '.ltx',
  '.latex',
  '.rtex',
  '.rnw',
  '.sty',
  '.cls',
  '.def',
  '.clo',
  '.dtx',
  '.ins',
  '.tikz',
  '.inc',
])
const IMAGE_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.eps',
  '.svg',
]
const BIB_EXTENSIONS = ['.bib', '.bibtex']

const fileNodeId = filePath => `file:${filePath}`
const occurrenceNodeId = (kind, location, identity = '') =>
  `${kind}:${location.entityId}:${location.from}:${encodeURIComponent(identity)}`

function extension(filePath) {
  return path.posix.extname(filePath).toLowerCase()
}

function isTexLike(filePath) {
  return TEX_EXTENSIONS.has(extension(filePath))
}

function isBibliography(filePath) {
  return BIB_EXTENSIONS.includes(extension(filePath))
}

function relationNode(graph, kind, item, parentPath, label) {
  const id = occurrenceNodeId(kind, item.location, label)
  graph.addNode({
    id,
    kind,
    label,
    path: parentPath,
    location: item.location,
    parentId: fileNodeId(parentPath),
  })
  graph.addEdge({
    kind: 'contains',
    from: fileNodeId(parentPath),
    to: id,
  })
  return id
}

function resolveRelations(parsed, availablePaths) {
  const result = {
    includes: [],
    figures: [],
    bibliographies: [],
  }
  for (const item of parsed.includes) {
    result.includes.push({
      ...item,
      resolution: resolveProjectPath({
        target: item.target,
        sourcePath: parsed.path,
        availablePaths,
        extensions: ['.tex'],
      }),
    })
  }
  for (const item of parsed.figures) {
    result.figures.push({
      ...item,
      resolution: resolveProjectPath({
        target: item.target,
        sourcePath: parsed.path,
        availablePaths,
        extensions: IMAGE_EXTENSIONS,
        additionalRoots: parsed.graphicPaths,
      }),
    })
  }
  for (const item of parsed.bibliographyFiles) {
    result.bibliographies.push({
      ...item,
      resolution: resolveProjectPath({
        target: item.target,
        sourcePath: parsed.path,
        availablePaths,
        extensions: BIB_EXTENSIONS,
      }),
    })
  }
  return result
}

function addResolvedRelationToGraph(graph, sourcePath, kind, item) {
  const commandId = relationNode(
    graph,
    kind,
    item,
    sourcePath,
    item.target
  )
  if (item.resolution.status === 'resolved') {
    graph.addEdge({
      kind,
      from: commandId,
      to: fileNodeId(item.resolution.path),
    })
  } else if (item.resolution.status === 'missing') {
    const missingId = `missing:${kind}:${sourcePath}:${item.target}`
    graph.addNode({
      id: missingId,
      kind: 'missing-resource',
      label: item.target,
      status: 'missing',
      path: sourcePath,
    })
    graph.addEdge({ kind, from: commandId, to: missingId })
  }
  return commandId
}

function collectScope(rootPath, latexByPath, relationsByPath, bibByPath) {
  const documents = new Set()
  const images = new Set()
  const bibliographies = new Set()
  const queue = [rootPath]
  let bibliographyIncomplete = false

  while (queue.length > 0) {
    const current = queue.shift()
    if (documents.has(current) || !latexByPath.has(current)) continue
    documents.add(current)
    const parsed = latexByPath.get(current)
    if (
      parsed.dynamicReferences.some(reference =>
        ['bibliography', 'addbibresource', 'bibliography-entry'].includes(
          reference.kind
        )
      )
    ) {
      bibliographyIncomplete = true
    }
    const relations = relationsByPath.get(current)
    for (const relation of relations.includes) {
      if (
        relation.resolution.status === 'resolved' &&
        latexByPath.has(relation.resolution.path)
      ) {
        queue.push(relation.resolution.path)
      }
    }
    for (const relation of relations.figures) {
      if (relation.resolution.status === 'resolved') {
        images.add(relation.resolution.path)
      } else if (relation.resolution.status === 'ambiguous') {
        for (const candidate of relation.resolution.candidates) {
          images.add(candidate)
        }
      }
    }
    for (const relation of relations.bibliographies) {
      if (relation.resolution.status === 'resolved') {
        bibliographies.add(relation.resolution.path)
        if (bibByPath.get(relation.resolution.path)?.unavailable) {
          bibliographyIncomplete = true
        }
      } else {
        bibliographyIncomplete = true
      }
    }
  }

  return { documents, images, bibliographies, bibliographyIncomplete }
}

function issueTitle(type, target) {
  const titles = {
    'missing-file': 'Missing included file',
    'missing-figure': 'Missing figure resource',
    'missing-bibliography': 'Missing bibliography file',
    'missing-reference': 'Reference has no matching label',
    'missing-citation': 'Citation has no matching bibliography entry',
    'duplicate-label': 'Duplicate label',
    'duplicate-bibliography-key': 'Duplicate bibliography key',
    'unreferenced-label': 'Label is not referenced',
    'unreferenced-figure': 'Figure is not referenced',
    'unreferenced-table': 'Table is not referenced',
    'unlabeled-figure': 'Figure has no label',
    'unlabeled-table': 'Table has no label',
    'unused-bibliography-entry': 'Bibliography entry is not cited',
    'possibly-unused-file': 'File is possibly unused',
    'circular-dependency': 'Circular file dependency',
  }
  return target ? `${titles[type] ?? type}: ${target}` : titles[type] ?? type
}

export function analyzeProject(snapshot) {
  const entities = [
    ...snapshot.documents.map(item => ({ ...item, entityKind: 'document' })),
    ...snapshot.files.map(item => ({ ...item, entityKind: 'file' })),
  ]
  const entityByPath = new Map(entities.map(entity => [entity.path, entity]))
  const entityById = new Map(entities.map(entity => [entity.id, entity]))
  const availablePaths = new Set(entityByPath.keys())
  const graph = new GraphBuilder()
  const issues = new IssueCollector()
  const issueGroups = {
    missing: new Set(),
    unused: new Set(),
    duplicate: new Set(),
    citationMissing: new Set(),
    citationUnused: new Set(),
    citationDuplicate: new Set(),
    circular: new Set(),
  }
  const addIssue = (key, issue, entryPointId, groups = []) => {
    issues.add(
      key,
      { ...issue, title: issueTitle(issue.type, issue.target) },
      entryPointId
    )
    for (const group of groups) issueGroups[group].add(key)
  }

  for (const entity of entities) {
    graph.addNode({
      id: fileNodeId(entity.path),
      kind: entity.entityKind,
      label: path.posix.basename(entity.path),
      path: entity.path,
      entityId: entity.id,
    })
  }

  const latexByPath = new Map()
  for (const doc of snapshot.documents) {
    if (isTexLike(doc.path)) latexByPath.set(doc.path, extractLatex(doc))
  }

  const bibByPath = new Map()
  for (const doc of snapshot.documents) {
    if (isBibliography(doc.path)) bibByPath.set(doc.path, extractBibtex(doc))
  }
  for (const file of snapshot.binaryBibliographies) {
    bibByPath.set(file.path, extractBibtex(file))
  }

  const relationsByPath = new Map()
  const ambiguousReferences = []
  for (const [sourcePath, parsed] of latexByPath) {
    const relations = resolveRelations(parsed, availablePaths)
    relationsByPath.set(sourcePath, relations)
    for (const [kind, items] of [
      ['include', relations.includes],
      ['figure', relations.figures],
      ['bibliography', relations.bibliographies],
    ]) {
      for (const item of items) {
        addResolvedRelationToGraph(graph, sourcePath, kind, item)
        if (item.resolution.status === 'ambiguous') {
          ambiguousReferences.push({
            kind,
            target: item.target,
            candidates: item.resolution.candidates,
            location: item.location,
          })
        }
      }
    }

    for (const label of parsed.labels) {
      relationNode(graph, 'label', label, sourcePath, label.key)
    }
    for (const reference of parsed.references) {
      relationNode(graph, 'reference', reference, sourcePath, reference.key)
    }
    for (const citation of parsed.citations) {
      relationNode(graph, 'citation', citation, sourcePath, citation.key)
    }
    for (const environment of parsed.environments) {
      relationNode(
        graph,
        environment.kind,
        environment,
        sourcePath,
        environment.name
      )
    }
  }

  for (const [bibPath, bibliography] of bibByPath) {
    for (const entry of bibliography.entries) {
      relationNode(graph, 'bibliography-entry', entry, bibPath, entry.key)
    }
  }

  const selectedRoots = snapshot.entryPointIds
    .map(id => entityById.get(id))
    .filter(Boolean)
  const scopes = selectedRoots.map(root => ({
    root,
    ...collectScope(root.path, latexByPath, relationsByPath, bibByPath),
  }))
  const reachableDocuments = new Set()
  const reachableImages = new Set()
  const reachableBibliographies = new Set()
  const usedLabels = new Set()
  const usedBibliographyEntries = new Set()
  const includeAdjacency = new Map()

  for (const scope of scopes) {
    for (const value of scope.documents) reachableDocuments.add(value)
    for (const value of scope.images) reachableImages.add(value)
    for (const value of scope.bibliographies) reachableBibliographies.add(value)

    const labelsByKey = new Map()
    const entriesByKey = new Map()
    const references = []
    const citations = []
    let labelsIncomplete = false

    for (const sourcePath of scope.documents) {
      const parsed = latexByPath.get(sourcePath)
      const relations = relationsByPath.get(sourcePath)
      if (!includeAdjacency.has(sourcePath)) includeAdjacency.set(sourcePath, [])

      for (const relation of relations.includes) {
        if (
          relation.resolution.status === 'resolved' &&
          scope.documents.has(relation.resolution.path)
        ) {
          includeAdjacency.get(sourcePath).push(relation.resolution.path)
        }
      }

      for (const [type, items] of [
        ['missing-file', relations.includes],
        ['missing-figure', relations.figures],
        ['missing-bibliography', relations.bibliographies],
      ]) {
        for (const item of items) {
          if (item.resolution.status !== 'missing') continue
          const kind = type.replace('missing-', '')
          const commandId = occurrenceNodeId(
            kind === 'file' ? 'include' : kind,
            item.location,
            item.target
          )
          const missingId = `missing:${kind === 'file' ? 'include' : kind}:${sourcePath}:${item.target}`
          addIssue(
            `${type}:${sourcePath}:${item.target}`,
            {
              type,
              status: 'missing',
              category: kind,
              target: item.target,
              locations: [item.location],
              nodeIds: [commandId, missingId],
            },
            scope.root.id,
            ['missing']
          )
        }
      }

      for (const label of parsed.labels) {
        const values = labelsByKey.get(label.key) ?? []
        values.push(label)
        labelsByKey.set(label.key, values)
      }
      references.push(...parsed.references)
      citations.push(...parsed.citations)
      labelsIncomplete ||= parsed.dynamicReferences.some(
        reference => reference.kind === 'label'
      )
      for (const entry of parsed.bibliographyEntries) {
        const values = entriesByKey.get(entry.key) ?? []
        values.push(entry)
        entriesByKey.set(entry.key, values)
      }
    }

    for (const bibPath of scope.bibliographies) {
      const bibliography = bibByPath.get(bibPath)
      if (!bibliography || bibliography.unavailable) continue
      for (const entry of bibliography.entries) {
        const values = entriesByKey.get(entry.key) ?? []
        values.push(entry)
        entriesByKey.set(entry.key, values)
      }
    }

    for (const [key, definitions] of labelsByKey) {
      if (definitions.length < 2) continue
      const nodeIds = definitions.map(definition =>
        occurrenceNodeId('label', definition.location, definition.key)
      )
      addIssue(
        `duplicate-label:${key}:${definitions.map(item => item.location.entityId).sort().join(',')}`,
        {
          type: 'duplicate-label',
          status: 'duplicate',
          category: 'label',
          target: key,
          locations: definitions.map(item => item.location),
          nodeIds,
        },
        scope.root.id,
        ['duplicate']
      )
    }

    for (const reference of references) {
      const definitions = labelsByKey.get(reference.key) ?? []
      const referenceId = occurrenceNodeId(
        'reference',
        reference.location,
        reference.key
      )
      if (definitions.length === 0 && !labelsIncomplete) {
        addIssue(
          `missing-reference:${reference.location.entityId}:${reference.location.from}:${reference.key}`,
          {
            type: 'missing-reference',
            status: 'missing',
            category: 'reference',
            target: reference.key,
            locations: [reference.location],
            nodeIds: [referenceId],
          },
          scope.root.id,
          ['missing']
        )
      } else {
        for (const definition of definitions) {
          usedLabels.add(
            occurrenceNodeId('label', definition.location, definition.key)
          )
          graph.addEdge({
            kind: 'references',
            from: referenceId,
            to: occurrenceNodeId(
              'label',
              definition.location,
              definition.key
            ),
          })
        }
      }
    }

    for (const [key, entries] of entriesByKey) {
      if (entries.length < 2) continue
      const nodeIds = entries.map(entry =>
        occurrenceNodeId('bibliography-entry', entry.location, entry.key)
      )
      addIssue(
        `duplicate-bibliography-key:${key}:${entries.map(item => item.location.entityId).sort().join(',')}`,
        {
          type: 'duplicate-bibliography-key',
          status: 'duplicate',
          category: 'bibliography',
          target: key,
          locations: entries.map(item => item.location),
          nodeIds,
        },
        scope.root.id,
        ['duplicate', 'citationDuplicate']
      )
    }

    const citeAll = citations.some(item => item.nocite && item.key === '*')
    if (citeAll) {
      for (const entries of entriesByKey.values()) {
        for (const entry of entries) {
          usedBibliographyEntries.add(
            occurrenceNodeId('bibliography-entry', entry.location, entry.key)
          )
        }
      }
    }
    for (const citation of citations) {
      if (citation.key === '*') continue
      const entries = entriesByKey.get(citation.key) ?? []
      const citationId = occurrenceNodeId(
        'citation',
        citation.location,
        citation.key
      )
      if (entries.length === 0 && !scope.bibliographyIncomplete) {
        addIssue(
          `missing-citation:${citation.location.entityId}:${citation.location.from}:${citation.key}`,
          {
            type: 'missing-citation',
            status: 'missing',
            category: 'citation',
            target: citation.key,
            locations: [citation.location],
            nodeIds: [citationId],
          },
          scope.root.id,
          ['missing', 'citationMissing']
        )
      }
      for (const entry of entries) {
        const entryId = occurrenceNodeId(
          'bibliography-entry',
          entry.location,
          entry.key
        )
        usedBibliographyEntries.add(entryId)
        graph.addEdge({ kind: 'cites', from: citationId, to: entryId })
      }
    }

    const scopeCycles = findCycles([...scope.documents], includeAdjacency)
    for (const cycle of scopeCycles) {
      const nodeIds = cycle.files.map(fileNodeId)
      addIssue(
        `circular-dependency:${cycle.files.join('|')}`,
        {
          type: 'circular-dependency',
          status: 'circular',
          category: 'file',
          target: cycle.path.join(' → '),
          locations: [],
          nodeIds,
        },
        scope.root.id,
        ['circular']
      )
    }
  }

  const reachableDynamicKinds = new Set(
    [...reachableDocuments].flatMap(sourcePath =>
      latexByPath
        .get(sourcePath)
        .dynamicReferences.map(reference => reference.kind)
    )
  )

  for (const sourcePath of reachableDocuments) {
    const parsed = latexByPath.get(sourcePath)
    for (const label of parsed.labels) {
      const nodeId = occurrenceNodeId('label', label.location, label.key)
      if (
        usedLabels.has(nodeId) ||
        reachableDynamicKinds.has('reference')
      ) {
        continue
      }
      addIssue(
        `unreferenced-label:${label.location.entityId}:${label.location.from}`,
        {
          type: 'unreferenced-label',
          status: 'unreferenced',
          category: 'label',
          target: label.key,
          locations: [label.location],
          nodeIds: [nodeId],
        },
        null,
        ['unused']
      )
    }
    for (const environment of parsed.environments) {
      const nodeId = occurrenceNodeId(
        environment.kind,
        environment.location,
        environment.name
      )
      if (environment.labels.length === 0) {
        const type = `unlabeled-${environment.kind}`
        addIssue(
          `${type}:${environment.location.entityId}:${environment.location.from}`,
          {
            type,
            status: 'unreferenced',
            category: environment.kind,
            target: environment.name,
            locations: [environment.location],
            nodeIds: [nodeId],
          },
          null,
          ['unused']
        )
      } else if (
        !reachableDynamicKinds.has('reference') &&
        environment.labels.every(labelKey => {
          const label = parsed.labels.find(item => item.key === labelKey)
          return (
            !label ||
            !usedLabels.has(
              occurrenceNodeId('label', label.location, label.key)
            )
          )
        })
      ) {
        const type = `unreferenced-${environment.kind}`
        addIssue(
          `${type}:${environment.location.entityId}:${environment.location.from}`,
          {
            type,
            status: 'unreferenced',
            category: environment.kind,
            target: environment.labels.join(', '),
            locations: [environment.location],
            nodeIds: [nodeId],
          },
          null,
          ['unused']
        )
      }
    }
  }

  for (const bibPath of reachableBibliographies) {
    const bibliography = bibByPath.get(bibPath)
    if (!bibliography || bibliography.unavailable) continue
    for (const entry of bibliography.entries) {
      const nodeId = occurrenceNodeId(
        'bibliography-entry',
        entry.location,
        entry.key
      )
      if (
        usedBibliographyEntries.has(nodeId) ||
        reachableDynamicKinds.has('citation')
      ) {
        continue
      }
      addIssue(
        `unused-bibliography-entry:${entry.location.entityId}:${entry.location.from}`,
        {
          type: 'unused-bibliography-entry',
          status: 'unused',
          category: 'bibliography',
          target: entry.key,
          locations: [entry.location],
          nodeIds: [nodeId],
        },
        null,
        ['unused', 'citationUnused']
      )
    }
  }

  for (const sourcePath of reachableDocuments) {
    const parsed = latexByPath.get(sourcePath)
    for (const entry of parsed.bibliographyEntries) {
      const nodeId = occurrenceNodeId(
        'bibliography-entry',
        entry.location,
        entry.key
      )
      if (
        usedBibliographyEntries.has(nodeId) ||
        reachableDynamicKinds.has('citation')
      ) {
        continue
      }
      addIssue(
        `unused-bibliography-entry:${entry.location.entityId}:${entry.location.from}`,
        {
          type: 'unused-bibliography-entry',
          status: 'unused',
          category: 'bibliography',
          target: entry.key,
          locations: [entry.location],
          nodeIds: [nodeId],
        },
        null,
        ['unused', 'citationUnused']
      )
    }
  }

  for (const entity of entities) {
    if (
      IMAGE_EXTENSIONS.includes(extension(entity.path)) &&
      !reachableImages.has(entity.path) &&
      !reachableDynamicKinds.has('includegraphics') &&
      !reachableDynamicKinds.has('includesvg') &&
      !reachableDynamicKinds.has('graphicspath')
    ) {
      addIssue(
        `unreferenced-figure:${entity.path}`,
        {
          type: 'unreferenced-figure',
          status: 'unreferenced',
          category: 'figure',
          target: entity.path,
          locations: [],
          nodeIds: [fileNodeId(entity.path)],
        },
        null,
        ['unused']
      )
    }

    const eligible = isTexLike(entity.path) || isBibliography(entity.path)
    const reachable =
      reachableDocuments.has(entity.path) ||
      reachableBibliographies.has(entity.path)
    if (eligible && !reachable) {
      addIssue(
        `possibly-unused-file:${entity.path}`,
        {
          type: 'possibly-unused-file',
          status: 'unused',
          category: 'file',
          target: entity.path,
          locations: [],
          nodeIds: [fileNodeId(entity.path)],
        },
        null,
        ['unused']
      )
    }
  }

  const cycles = findCycles([...reachableDocuments], includeAdjacency)
  const finalized = issues.finalize()
  for (const issue of Object.values(finalized.byId)) {
    graph.markNodes(issue.nodeIds, issue.status)
  }
  const idsFor = group =>
    [...issueGroups[group]]
      .map(key => finalized.keyToId.get(key))
      .filter(Boolean)

  const reachableEntityPaths = new Set([
    ...reachableDocuments,
    ...reachableImages,
    ...reachableBibliographies,
  ])
  const reachableLatex = [...reachableDocuments]
    .map(filePath => latexByPath.get(filePath))
    .filter(Boolean)
  const dynamicReferences = reachableLatex.flatMap(item =>
    item.dynamicReferences.map(reference => ({
      ...reference,
      sourcePath: item.path,
    }))
  )
  const parseErrors = [
    ...reachableLatex,
    ...[...reachableBibliographies]
      .map(filePath => bibByPath.get(filePath))
      .filter(Boolean),
  ]
    .filter(item => item.parseErrorCount > 0)
    .map(item => ({ path: item.path, count: item.parseErrorCount }))
  const skippedFiles = [...bibByPath.values()]
    .filter(
      item => item.unavailable && reachableBibliographies.has(item.path)
    )
    .map(item => ({ path: item.path, reason: item.skippedReason }))
  const reachableAmbiguousReferences = ambiguousReferences.filter(item =>
    reachableDocuments.has(item.location.path)
  )

  return {
    entryPoints: selectedRoots.map(root => ({ id: root.id, path: root.path })),
    overview: {
      fileCount: reachableEntityPaths.size,
      figureCount: reachableLatex.reduce(
        (count, item) =>
          count + item.environments.filter(env => env.kind === 'figure').length,
        0
      ),
      tableCount: reachableLatex.reduce(
        (count, item) =>
          count + item.environments.filter(env => env.kind === 'table').length,
        0
      ),
      citationCount: reachableLatex.reduce(
        (count, item) => count + item.citations.length,
        0
      ),
      missing: idsFor('missing').length,
      unusedUnreferenced: idsFor('unused').length,
      duplicate: idsFor('duplicate').length,
      circular: cycles.length,
    },
    graph: graph.serialize({
      roots: selectedRoots.map(root => fileNodeId(root.path)),
      cycles: cycles.map(cycle => cycle.path.map(fileNodeId)),
    }),
    issues: { byId: finalized.byId, truncated: finalized.truncated },
    views: {
      missing: idsFor('missing'),
      unused: idsFor('unused'),
      duplicate: idsFor('duplicate'),
      circular: idsFor('circular'),
      citation: {
        missing: idsFor('citationMissing'),
        unused: idsFor('citationUnused'),
        duplicate: idsFor('citationDuplicate'),
      },
    },
    coverage: {
      parsedFiles: reachableLatex.length + reachableBibliographies.size,
      parseErrors,
      dynamicReferences: dynamicReferences.slice(0, 500),
      ambiguousReferences: reachableAmbiguousReferences.slice(0, 500),
      skippedFiles,
      suppressedCitationChecks: scopes
        .filter(scope => scope.bibliographyIncomplete)
        .map(scope => scope.root.id),
      truncated:
        dynamicReferences.length > 500 ||
        reachableAmbiguousReferences.length > 500 ||
        finalized.truncated,
    },
  }
}

export default analyzeProject
