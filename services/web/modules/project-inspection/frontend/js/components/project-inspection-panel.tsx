import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FetchError } from '@/infrastructure/fetch-json'
import Button from '@/shared/components/ol/ol-button'
import MaterialIcon, {
  type AvailableUnfilledIcon,
} from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLButton from '@/shared/components/ol/ol-button'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import newEditorIconTypeFromName from '@/features/file-tree/util/icon-type-from-name'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { isValidTeXFile } from '@/main/is-valid-tex-file'
import { signalWithTimeout } from '@/utils/abort-signal'
import { debugConsole } from '@/utils/debugging'
import { analyzeProject } from '../api'
import type {
  InspectionGraphNode,
  InspectionIssue,
  ProjectInspectionResult,
  SourceLocation,
} from '../types'
import '../../stylesheets/project-inspection.scss'

const PAGE_SIZE = 100
const MAX_ENTRY_POINTS = 50
const TOOLTIP_AUTO_HIDE_DELAY = 2500

function getErrorMessage(
  error: unknown,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (
    error &&
    typeof error === 'object' &&
    'getUserFacingMessage' in error &&
    typeof error.getUserFacingMessage === 'function'
  ) {
    const message = String(error.getUserFacingMessage())
    return message.startsWith('inspection_error_')
      ? t(message, error instanceof FetchError ? error.data?.params ?? {} : {})
      : message
  }
  return t('inspection_error')
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`project-inspection-status project-inspection-status-${status}`}
      aria-hidden="true"
    />
  )
}

const DEPENDENCY_TYPE_ICONS: Record<
  string,
  { icon: string; label: string }
> = {
  document: { icon: 'description', label: 'inspection_type_document' },
  file: { icon: 'description', label: 'file' },
  'figure-file': {
    icon: 'description',
    label: 'image_file',
  },
  include: { icon: 'input', label: 'inspection_type_included_file' },
  figure: { icon: 'image', label: 'figure' },
  table: { icon: 'table_chart', label: 'table' },
  label: { icon: 'label', label: 'inspection_type_label' },
  reference: { icon: 'link', label: 'reference' },
  citation: { icon: 'format_quote', label: 'citation' },
  'citation-occurrence': {
    icon: 'link',
    label: 'inspection_type_citation_occurrence',
  },
  bibliography: { icon: 'book_5', label: 'inspection_type_bibliography' },
  'bibliography-include': {
    icon: 'input',
    label: 'inspection_type_included_bibliography_file',
  },
  'bibliography-entry': {
    icon: 'text_snippet',
    label: 'inspection_type_bibliography_entry',
  },
  'missing-resource': { icon: 'help', label: 'inspection_type_missing_resource' },
}

const ISSUE_DEPENDENCY_TYPES: Record<string, string> = {
  'missing-file': 'include',
  'missing-figure': 'figure-file',
  'missing-bibliography': 'bibliography',
  'unreferenced-label': 'label',
  'unreferenced-figure': 'figure',
  'unreferenced-table': 'table',
  'unlabeled-figure': 'figure',
  'unlabeled-table': 'table',
  'unused-bibliography-entry': 'bibliography-entry',
  'possibly-unused-file': 'file',
  'duplicate-label': 'label',
  'duplicate-figure-caption': 'figure',
  'duplicate-table-caption': 'table',
  'duplicate-bibliography-key': 'bibliography-entry',
  'duplicate-bibliography-title': 'bibliography-entry',
}

const UNFILLED_CATEGORY_ICONS = new Set<AvailableUnfilledIcon>([
  'book_5',
  'description',
  'format_quote',
  'image',
  'input',
  'label',
  'link',
  'table_chart',
  'text_snippet',
])

function isUnfilledCategoryIcon(
  icon: string
): icon is AvailableUnfilledIcon {
  return UNFILLED_CATEGORY_ICONS.has(icon as AvailableUnfilledIcon)
}

function CategoryIcon({ issue }: { issue: InspectionIssue }) {
  const { t } = useTranslation()
  if (
    issue.target &&
    [
      'missing-file',
      'missing-figure',
      'missing-bibliography',
      'possibly-unused-file',
    ].includes(issue.type)
  ) {
    return (
      <MaterialIcon
        unfilled
        type={newEditorIconTypeFromName(issue.target)}
        accessibilityLabel={t('file')}
        className="project-inspection-category-icon"
      />
    )
  }
  const type = ISSUE_DEPENDENCY_TYPES[issue.type] ?? issue.category
  const definition =
    DEPENDENCY_TYPE_ICONS[type] ?? DEPENDENCY_TYPE_ICONS['missing-resource']
  if (isUnfilledCategoryIcon(definition.icon)) {
    return (
      <MaterialIcon
        unfilled
        type={definition.icon}
        accessibilityLabel={t(definition.label)}
        className="project-inspection-category-icon"
      />
    )
  }
  return (
    <MaterialIcon
      type={definition.icon}
      accessibilityLabel={t(definition.label)}
      className="project-inspection-category-icon"
    />
  )
}

const DEPENDENCY_STATUS_ICONS: Record<
  Exclude<InspectionGraphNode['status'], 'normal'>,
  string
> = {
  missing: 'error',
  unused: 'warning',
  unreferenced: 'warning',
  duplicate: 'content_copy',
  circular: 'autorenew',
}

const DEPENDENCY_STATUS_LABELS: Record<
  Exclude<InspectionGraphNode['status'], 'normal'>,
  string
> = {
  missing: 'inspection_status_missing',
  unused: 'inspection_status_unused',
  unreferenced: 'inspection_status_unreferenced',
  duplicate: 'inspection_status_duplicate',
  circular: 'inspection_status_circular',
}

const DEPENDENCY_STATUS_PRIORITY: Record<
  InspectionGraphNode['status'],
  number
> = {
  normal: 0,
  unused: 1,
  unreferenced: 1,
  duplicate: 2,
  missing: 3,
  circular: 4,
}

function higherPriorityStatus(
  current: InspectionGraphNode['status'],
  candidate: InspectionGraphNode['status']
) {
  return DEPENDENCY_STATUS_PRIORITY[candidate] >
    DEPENDENCY_STATUS_PRIORITY[current]
    ? candidate
    : current
}

function dependencyType(node: InspectionGraphNode, incomingKind?: string) {
  if (node.kind === 'missing-resource') {
    return incomingKind ?? node.kind
  }
  if (node.kind === 'document' || node.kind === 'file') {
    const filePath = node.path ?? ''
    if (/\.(?:bib|bibtex)$/i.test(filePath)) return 'bibliography'
    if (/\.(?:pdf|png|jpe?g|eps|svg)$/i.test(filePath)) return 'figure'
  }
  return node.kind
}

function dependencyIconType(
  node: InspectionGraphNode,
  incomingKind?: string
) {
  if (node.kind === 'bibliography') return 'bibliography-include'
  return dependencyType(node, incomingKind)
}

const DEPENDENCY_TYPE_ORDER: Record<string, number> = {
  include: 0,
  input: 0,
  document: 0,
  file: 0,
  'figure-file': 0,
  figure: 1,
  table: 2,
  label: 3,
  reference: 3,
  citation: 4,
  'citation-occurrence': 4,
  bibliography: 5,
  'bibliography-entry': 5,
}

const DEPENDENCY_LABEL_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
})

function compareDependencyNodes(
  leftId: string,
  rightId: string,
  nodes: Map<string, InspectionGraphNode>,
  incomingKinds: Map<string, string>
) {
  const left = nodes.get(leftId)
  const right = nodes.get(rightId)
  if (!left || !right) return leftId.localeCompare(rightId)
  const leftType = dependencyType(left, incomingKinds.get(leftId))
  const rightType = dependencyType(right, incomingKinds.get(rightId))
  const typeDifference =
    (DEPENDENCY_TYPE_ORDER[leftType] ?? Number.MAX_SAFE_INTEGER) -
    (DEPENDENCY_TYPE_ORDER[rightType] ?? Number.MAX_SAFE_INTEGER)
  if (typeDifference !== 0) return typeDifference
  const labelDifference = DEPENDENCY_LABEL_COLLATOR.compare(
    left.label,
    right.label
  )
  return labelDifference || left.id.localeCompare(right.id)
}

function DependencyTypeIcon({
  node,
  incomingKind,
}: {
  node: InspectionGraphNode
  incomingKind?: string
}) {
  const { t } = useTranslation()
  if (
    node.kind === 'document' ||
    node.kind === 'file' ||
    node.kind === 'figure-file' ||
    node.kind === 'missing-resource'
  ) {
    const filePath = node.path ?? node.label
    return (
      <MaterialIcon
        unfilled
        type={newEditorIconTypeFromName(filePath)}
        accessibilityLabel={t('file')}
      />
    )
  }
  const type = dependencyIconType(node, incomingKind)
  const definition =
    DEPENDENCY_TYPE_ICONS[type] ?? DEPENDENCY_TYPE_ICONS['missing-resource']
  if (
    isUnfilledCategoryIcon(definition.icon)
  ) {
    return (
      <MaterialIcon
        unfilled
        type={definition.icon}
        accessibilityLabel={t(definition.label)}
        className="project-inspection-tree-type"
      />
    )
  }
  return (
    <MaterialIcon
      type={definition.icon}
      accessibilityLabel={t(definition.label)}
      className="project-inspection-tree-type"
    />
  )
}

function DependencyStatus({
  status,
  showLabel = true,
}: {
  status: InspectionGraphNode['status']
  showLabel?: boolean
}) {
  const { t } = useTranslation()
  if (status === 'normal') return null
  return (
    <span
      className={`project-inspection-tree-status project-inspection-tree-status-${status}${showLabel ? '' : ' project-inspection-tree-status-icon-only'}`}
    >
      <MaterialIcon
        unfilled
        type={DEPENDENCY_STATUS_ICONS[status]}
        accessibilityLabel={
          showLabel
            ? undefined
            : t('inspection_contains_issue', {
                status: t(DEPENDENCY_STATUS_LABELS[status]),
              })
        }
        className="project-inspection-tree-status-icon"
      />
      {showLabel && t(DEPENDENCY_STATUS_LABELS[status])}
    </span>
  )
}

function translatedIssueTitle(
  issue: InspectionIssue,
  t: ReturnType<typeof useTranslation>['t']
) {
  const title = t(issue.title)
  return issue.target
    ? t('inspection_issue_with_target', { title, target: issue.target })
    : title
}

type Navigate = (location?: SourceLocation, fallbackPath?: string) => void

function CircularIssue({
  issue,
  onNavigate,
}: {
  issue: InspectionIssue
  onNavigate: Navigate
}) {
  const { t } = useTranslation()
  const title = translatedIssueTitle(issue, t)
  return (
    <>
      <div className="project-inspection-issue">
        <MaterialIcon
          type="autorenew"
          accessibilityLabel={t('inspection_circular_dependency')}
          className="project-inspection-category-icon project-inspection-circular-icon"
        />
        <span
          className="project-inspection-issue-title"
          title={title}
        >
          {title}
        </span>
      </div>
      {issue.cycleEdges?.map(edge => (
        <button
          type="button"
          className="project-inspection-secondary-location"
          key={`${edge.from}:${edge.to}:${edge.location.from}`}
          title={`${edge.from} → ${edge.to}`}
          onClick={() => onNavigate(edge.location)}
        >
          {edge.from} → {edge.to}
        </button>
      ))}
    </>
  )
}

function IssueList({
  ids,
  issues,
  onNavigate,
}: {
  ids: string[]
  issues: Record<string, InspectionIssue>
  onNavigate: Navigate
}) {
  const { t } = useTranslation()
  const [limit, setLimit] = useState(PAGE_SIZE)
  useEffect(() => setLimit(PAGE_SIZE), [ids])

  if (ids.length === 0) {
    return (
      <p className="project-inspection-empty">
        {t('inspection_no_issues_found')}
      </p>
    )
  }

  return (
    <>
      <ul className="project-inspection-issue-list">
        {ids.slice(0, limit).map(id => {
          const issue = issues[id]
          if (!issue) return null
          const title = translatedIssueTitle(issue, t)
          const primaryLocation = issue.locations[0]
          if (issue.type === 'circular-dependency') {
            return (
              <li key={id}>
                <CircularIssue issue={issue} onNavigate={onNavigate} />
              </li>
            )
          }
          return (
            <li key={id}>
              {primaryLocation ? (
                <div className="project-inspection-issue">
                  <CategoryIcon issue={issue} />
                  <span className="project-inspection-issue-content">
                    <span
                      className="project-inspection-issue-title"
                      title={title}
                    >
                      {title}
                    </span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="project-inspection-issue"
                  onClick={() => onNavigate(undefined, issue.target)}
                >
                  <CategoryIcon issue={issue} />
                  <span className="project-inspection-issue-content">
                    <span
                      className="project-inspection-issue-title"
                      title={title}
                    >
                      {title}
                    </span>
                  </span>
                </button>
              )}
              {issue.locations.map(location => (
                <button
                  type="button"
                  className="project-inspection-secondary-location"
                  key={`${location.entityId}:${location.from}`}
                  title={`${location.path}:${location.line}`}
                  onClick={() => onNavigate(location)}
                >
                  {location.path}:{location.line}
                </button>
              ))}
            </li>
          )
        })}
      </ul>
      {limit < ids.length && (
        <div className="d-flex justify-content-center">
          <OLButton
            variant="secondary"
            size="sm"
            onClick={() => setLimit(value => value + PAGE_SIZE)}
          >
            {t('inspection_show_more')}
          </OLButton>
        </div>
      )}
    </>
  )
}

function InspectionCaret() {
  return (
    <MaterialIcon
      type="keyboard_arrow_right"
      className="project-inspection-caret"
      aria-hidden="true"
    />
  )
}

function IssueSection({
  id,
  title,
  issueIds,
  result,
  onNavigate,
  open = false,
}: {
  id: string
  title: string
  issueIds: string[]
  result: ProjectInspectionResult
  onNavigate: Navigate
  open?: boolean
}) {
  const [expanded, setExpanded] = useState(open)
  return (
    <details
      id={id}
      className="project-inspection-section"
      open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <InspectionCaret />
        <span>{title}</span>
        <span className="project-inspection-count">{issueIds.length}</span>
      </summary>
      {expanded && (
        <div className="project-inspection-children">
          <IssueList
            ids={issueIds}
            issues={result.issues.byId}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </details>
  )
}

function DependencyNode({
  nodeId,
  nodes,
  childrenByParent,
  incomingKindByNode,
  subtreeStatusByNode,
  path,
  onNavigate,
  root = false,
}: {
  nodeId: string
  nodes: Map<string, InspectionGraphNode>
  childrenByParent: Map<string, string[]>
  incomingKindByNode: Map<string, string>
  subtreeStatusByNode: Map<string, InspectionGraphNode['status']>
  path: Set<string>
  onNavigate: Navigate
  root?: boolean
}) {
  const [expanded, setExpanded] = useState(root)
  const { t } = useTranslation()
  const node = nodes.get(nodeId)
  if (!node) return null
  const generatedEnvironmentLabel =
    (node.kind === 'figure' || node.kind === 'table') &&
    node.path &&
    node.location &&
    node.label === `${node.kind === 'figure' ? 'Figure' : 'Table'} ${node.path}:${node.location.line}`
  const displayLabel =
    node.kind === 'document' || node.kind === 'file'
      ? (node.path ?? node.label)
      : generatedEnvironmentLabel
        ? `${t(node.kind)} ${node.path}:${node.location?.line}`
        : node.label
  const children = childrenByParent.get(nodeId) ?? []
  const circular = path.has(nodeId)
  const hasDirectStatus = node.status !== 'normal'
  const displayStatus = hasDirectStatus
    ? node.status
    : circular
      ? 'circular'
      : (subtreeStatusByNode.get(nodeId) ?? 'normal')
  const showStatusLabel = hasDirectStatus || circular
  if (children.length === 0 || circular) {
    return (
      <li>
        <div className="project-inspection-tree-row">
          <span className="project-inspection-caret" aria-hidden="true" />
          <DependencyTypeIcon
            node={node}
            incomingKind={incomingKindByNode.get(nodeId)}
          />
          <button
            type="button"
            className="project-inspection-tree-link"
            title={displayLabel}
            onClick={() => onNavigate(node.location, node.path)}
          >
            {displayLabel}
          </button>
          <DependencyStatus
            status={displayStatus}
            showLabel={showStatusLabel}
          />
        </div>
      </li>
    )
  }

  const nextPath = new Set(path)
  nextPath.add(nodeId)
  return (
    <li>
      <details
        open={expanded}
        onToggle={event => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <InspectionCaret />
          <DependencyTypeIcon
            node={node}
            incomingKind={incomingKindByNode.get(nodeId)}
          />
          <button
            type="button"
            className="project-inspection-tree-link"
            title={displayLabel}
            onClick={event => {
              event.preventDefault()
              onNavigate(node.location, node.path)
            }}
          >
            {displayLabel}
          </button>
          <DependencyStatus
            status={displayStatus}
            showLabel={showStatusLabel}
          />
        </summary>
        {expanded && (
          <ul className="project-inspection-children">
            {children.map(childId => (
              <DependencyNode
                key={`${nodeId}:${childId}`}
                nodeId={childId}
                nodes={nodes}
                childrenByParent={childrenByParent}
                incomingKindByNode={incomingKindByNode}
                subtreeStatusByNode={subtreeStatusByNode}
                path={nextPath}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </details>
    </li>
  )
}

function DependencyTree({
  result,
  onNavigate,
}: {
  result: ProjectInspectionResult
  onNavigate: Navigate
}) {
  const { t } = useTranslation()
  const { nodes, childrenByParent, incomingKindByNode, subtreeStatusByNode } =
    useMemo(() => {
      const nodeMap = new Map(result.graph.nodes.map(node => [node.id, node]))
      const outgoing = new Map<string, string[]>()
      const parentsByChild = new Map<string, string[]>()
      const incomingKinds = new Map<string, string>()
      const addChild = (parentId: string, childId: string) => {
        const children = outgoing.get(parentId) ?? []
        if (!children.includes(childId)) children.push(childId)
        outgoing.set(parentId, children)
        const parents = parentsByChild.get(childId) ?? []
        if (!parents.includes(parentId)) parents.push(parentId)
        parentsByChild.set(childId, parents)
      }
      for (const node of result.graph.nodes) {
        if (node.parentId) addChild(node.parentId, node.id)
      }
      for (const edge of result.graph.edges) {
        if (edge.kind === 'contains') continue
        addChild(edge.from, edge.to)
        if (!incomingKinds.has(edge.to)) incomingKinds.set(edge.to, edge.kind)
      }
      for (const children of outgoing.values()) {
        children.sort((leftId, rightId) =>
          compareDependencyNodes(leftId, rightId, nodeMap, incomingKinds)
        )
      }
      const subtreeStatuses = new Map<string, InspectionGraphNode['status']>()
      const pending: string[] = []
      for (const node of result.graph.nodes) {
        subtreeStatuses.set(node.id, node.status)
        if (node.status !== 'normal') pending.push(node.id)
      }
      for (let index = 0; index < pending.length; index += 1) {
        const childId = pending[index]
        const childStatus = subtreeStatuses.get(childId) ?? 'normal'
        for (const parentId of parentsByChild.get(childId) ?? []) {
          const parentStatus = subtreeStatuses.get(parentId) ?? 'normal'
          const nextStatus = higherPriorityStatus(parentStatus, childStatus)
          if (nextStatus === parentStatus) continue
          subtreeStatuses.set(parentId, nextStatus)
          pending.push(parentId)
        }
      }
      return {
        nodes: nodeMap,
        childrenByParent: outgoing,
        incomingKindByNode: incomingKinds,
        subtreeStatusByNode: subtreeStatuses,
      }
    }, [result])

  return (
    <details
      id="inspection-dependencies"
      className="project-inspection-section"
      open
    >
      <summary>
        <InspectionCaret />
        <span>{t('inspection_dependency_tree')}</span>
      </summary>
      <ul className="project-inspection-tree project-inspection-children">
        {result.graph.roots.map(root => (
          <DependencyNode
            key={root}
            nodeId={root}
            nodes={nodes}
            childrenByParent={childrenByParent}
            incomingKindByNode={incomingKindByNode}
            subtreeStatusByNode={subtreeStatusByNode}
            path={new Set()}
            onNavigate={onNavigate}
            root
          />
        ))}
      </ul>
      {result.graph.truncated && (
        <p className="project-inspection-note">
          {t('inspection_graph_truncated')}
        </p>
      )}
    </details>
  )
}

function ProjectInspectionPanel() {
  const { t } = useTranslation()
  const { projectId, project } = useProjectContext()
  const { docs } = useFileTreeData()
  const { findEntityByPath } = useFileTreePathContext()
  const { openDocs, openDocWithId, openFileWithId } =
    useEditorManagerContext()
  const entryPoints = useMemo(
    () => (docs ?? []).filter(item => isValidTeXFile(item.path)),
    [docs]
  )
  const displayedEntryPoints = useMemo(() => {
    const preferred =
      entryPoints.find(item => item.doc.id === project?.rootDocId) ??
      entryPoints[0]
    if (!preferred) return entryPoints
    return [
      preferred,
      ...entryPoints.filter(item => item.doc.id !== preferred.doc.id),
    ]
  }, [entryPoints, project?.rootDocId])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<ProjectInspectionResult>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [expiredTooltip, setExpiredTooltip] = useState<string | null>(null)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const abortControllerRef = useRef<AbortController | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedIds(current => {
      const validIds = new Set(entryPoints.map(item => String(item.doc.id)))
      const next = new Set([...current].filter(id => validIds.has(id)))
      if (next.size === 0) {
        const preferred =
          entryPoints.find(item => item.doc.id === project?.rootDocId) ??
          entryPoints[0]
        if (preferred) next.add(String(preferred.doc.id))
      }
      return next
    })
  }, [entryPoints, project?.rootDocId])

  useEffect(
    () => () => {
      abortControllerRef.current?.abort()
      clearTimeout(tooltipTimeoutRef.current)
    },
    []
  )

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (selectedIds.size === 0) return
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      setLoading(true)
      setError(undefined)
      try {
        await openDocs.awaitBufferedOps(
          signalWithTimeout(controller.signal, 5000)
        )
        const nextResult = await analyzeProject(
          projectId,
          [...selectedIds],
          controller.signal
        )
        if (!controller.signal.aborted) setResult(nextResult)
      } catch (error) {
        if (!controller.signal.aborted) {
          debugConsole.error(error)
          setError(getErrorMessage(error, t))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [openDocs, projectId, selectedIds, t]
  )

  const onNavigate = useCallback<Navigate>(
    (location, fallbackPath) => {
      const projectPath = location?.path ?? fallbackPath
      if (!projectPath) return
      const found = findEntityByPath(projectPath)
      if (!found) return
      if (found.type === 'doc') {
        openDocWithId(
          String(found.entity._id),
          location
            ? {
                gotoLine: location.line,
                gotoColumn: location.column,
                selectText: location.sourceText,
              }
            : undefined
        ).catch(debugConsole.error)
      } else if (found.type === 'fileRef') {
        openFileWithId(String(found.entity._id))
      }
    },
    [findEntityByPath, openDocWithId, openFileWithId]
  )

  const startTooltipTimeout = (id: string) => {
    clearTimeout(tooltipTimeoutRef.current)
    setExpiredTooltip(null)
    tooltipTimeoutRef.current = setTimeout(() => {
      setExpiredTooltip(id)
    }, TOOLTIP_AUTO_HIDE_DELAY)
  }

  const clearTooltipTimeout = () => {
    clearTimeout(tooltipTimeoutRef.current)
    setExpiredTooltip(null)
  }

  const scrollToSection = (id: string) => {
    const container = contentRef.current
    const target = container?.querySelector<HTMLElement>(`#${id}`)
    if (!container || !target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    container.scrollTo({
      top: container.scrollTop + targetRect.top - containerRect.top,
      behavior: 'smooth',
    })
  }
  const coverageWarningCount = result
    ? result.coverage.parseErrors.length +
      result.coverage.dynamicReferences.length +
      result.coverage.ambiguousReferences.length +
      result.coverage.skippedFiles.length +
      result.coverage.suppressedCitationChecks.length
    : 0
  const hasCoverageWarning = Boolean(
    result &&
      (coverageWarningCount > 0 ||
        result.coverage.truncated ||
        result.graph.truncated)
  )

  return (
    <div className="project-inspection-panel">
      <RailPanelHeader title={t('inspection_title')} />
      <div ref={contentRef} className="project-inspection-content">
        <form onSubmit={onSubmit}>
          <fieldset disabled={loading}>
            <legend>{t('inspection_entry_points')}</legend>
            <div className="project-inspection-entry-points">
              {displayedEntryPoints.map(item => {
                const id = String(item.doc.id)
                return (
                  <OLFormCheckbox
                    key={id}
                    id={`project-inspection-entry-${id}`}
                    label={
                      <span
                        className="project-inspection-entry-label"
                        title={item.path}
                      >
                        {item.path}
                      </span>
                    }
                    checked={selectedIds.has(id)}
                    disabled={
                      !selectedIds.has(id) &&
                      selectedIds.size >= MAX_ENTRY_POINTS
                    }
                    onChange={event => {
                      setSelectedIds(current => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(id)
                        else next.delete(id)
                        return next
                      })
                    }}
                  />
                )
              })}
            </div>
            {entryPoints.length === 0 && (
              <p className="project-inspection-note">
                {t('inspection_no_entry_points')}
              </p>
            )}
            {selectedIds.size >= MAX_ENTRY_POINTS && (
              <p className="project-inspection-note">
                {t('inspection_entry_point_limit', {
                  count: MAX_ENTRY_POINTS,
                })}
              </p>
            )}
            <div className="d-flex justify-content-center">
              <OLButton
                type="submit"
                size="sm"
                isLoading={loading}
                loadingLabel={t('inspection_analyzing')}
                disabled={selectedIds.size === 0}
              >
                {t('inspection_analyze')}
              </OLButton>
            </div>
          </fieldset>
        </form>

        {error && <Notification type="error" className="mt-2" content={error} />}

        {result && (
          <>
            <p className="project-inspection-timestamp">
              {t('inspection_last_analyzed', {
                time: new Date(result.analyzedAt).toLocaleTimeString(),
              })}
            </p>
            {hasCoverageWarning && (
              <Notification
                type="warning"
                content={t('inspection_coverage_warning', {
                  count: coverageWarningCount,
                })}
              />
            )}
            <hr className="project-inspection-divider" />
            <section className="project-inspection-overview">
              <h3>{t('overview')}</h3>
              <p className="project-inspection-totals">
                {result.overview.fileCount} {t('inspection_files')} ·{' '}
                {result.overview.figureCount} {t('inspection_figures')} ·{' '}
                {result.overview.tableCount} {t('inspection_tables')} ·{' '}
                {result.overview.citationCount} {t('inspection_citations')}
              </p>
              <div className="project-inspection-summary-grid">
                <OLTooltip
                  id="project-inspection-overview-circular"
                  hidden={expiredTooltip === 'circular'}
                  description={t('inspection_circular_description')}
                  overlayProps={{
                    placement: 'top',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-circular')}
                    onMouseEnter={() => startTooltipTimeout('circular')}
                    onMouseLeave={clearTooltipTimeout}
                    onFocus={() => startTooltipTimeout('circular')}
                    onBlur={clearTooltipTimeout}
                  >
                    <StatusDot status="circular" />
                    {t('inspection_circular')}
                    <strong>{result.overview.circular}</strong>
                  </button>
                </OLTooltip>
                <OLTooltip
                  id="project-inspection-overview-missing"
                  hidden={expiredTooltip === 'missing'}
                  description={t('inspection_missing_description')}
                  overlayProps={{
                    placement: 'top',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-missing')}
                    onMouseEnter={() => startTooltipTimeout('missing')}
                    onMouseLeave={clearTooltipTimeout}
                    onFocus={() => startTooltipTimeout('missing')}
                    onBlur={clearTooltipTimeout}
                  >
                    <StatusDot status="missing" />
                    {t('inspection_missing')}
                    <strong>{result.overview.missing}</strong>
                  </button>
                </OLTooltip>
                <OLTooltip
                  id="project-inspection-overview-duplicate"
                  hidden={expiredTooltip === 'duplicate'}
                  description={t('inspection_duplicate_description')}
                  overlayProps={{
                    placement: 'bottom',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-duplicate')}
                    onMouseEnter={() => startTooltipTimeout('duplicate')}
                    onMouseLeave={clearTooltipTimeout}
                    onFocus={() => startTooltipTimeout('duplicate')}
                    onBlur={clearTooltipTimeout}
                  >
                    <StatusDot status="duplicate" />
                    {t('inspection_duplicate')}
                    <strong>{result.overview.duplicate}</strong>
                  </button>
                </OLTooltip>
                <OLTooltip
                  id="project-inspection-overview-unused"
                  hidden={expiredTooltip === 'unused'}
                  description={t('inspection_unused_description')}
                  overlayProps={{
                    placement: 'bottom',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-unused')}
                    onMouseEnter={() => startTooltipTimeout('unused')}
                    onMouseLeave={clearTooltipTimeout}
                    onFocus={() => startTooltipTimeout('unused')}
                    onBlur={clearTooltipTimeout}
                  >
                    <StatusDot status="unused" />
                    {t('inspection_unused')}
                    <strong>{result.overview.unusedUnreferenced}</strong>
                  </button>
                </OLTooltip>
              </div>
            </section>
            <DependencyTree result={result} onNavigate={onNavigate} />
            <IssueSection
              id="inspection-circular"
              title={t('inspection_circular_dependencies')}
              issueIds={result.views.circular}
              result={result}
              onNavigate={onNavigate}
            />
            <IssueSection
              id="inspection-missing"
              title={t('inspection_missing_components')}
              issueIds={result.views.missing}
              result={result}
              onNavigate={onNavigate}
              open
            />
            <IssueSection
              id="inspection-duplicate"
              title={t('inspection_duplicate_components')}
              issueIds={result.views.duplicate}
              result={result}
              onNavigate={onNavigate}
            />
            <IssueSection
              id="inspection-unused"
              title={`${t('inspection_unused')} / ${t('inspection_unreferenced')} ${t('inspection_components')}`}
              issueIds={result.views.unused}
              result={result}
              onNavigate={onNavigate}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default ProjectInspectionPanel
