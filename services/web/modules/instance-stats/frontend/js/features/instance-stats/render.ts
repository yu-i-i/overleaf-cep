import type { SeriesPoint, StatConfig } from './types'

declare global {
  interface Window {
    Plotly?: {
      newPlot: (
        id: string,
        traces: unknown[],
        layout: Record<string, unknown>,
        config: Record<string, unknown>
      ) => Promise<unknown>
      update?: (
        id: string,
        data: unknown[],
        layout?: Record<string, unknown>
      ) => Promise<unknown>
      animate?: (
        id: string,
        frameOrGroupNameOrAnimationDef: Record<string, unknown>,
        animationOpts: Record<string, unknown>
      ) => Promise<unknown>
    }
  }
}

function getSeriesCount(stat: StatConfig, points: SeriesPoint[]) {
  const maxValuesLength = points.reduce(
    (max, point) => Math.max(max, point.values.length),
    0
  )
  if (maxValuesLength >= 2) return 2
  if (maxValuesLength === 1) return 1
  return stat.seriesCount
}

function buildTraces(stat: StatConfig, points: SeriesPoint[]) {
  const x = points.map(point => point.day)
  const seriesCount = getSeriesCount(stat, points)
  const indexes = seriesCount === 2 ? [0, 1] : [0]
  return indexes.map(index => {
    const key = index === 0 ? 'y1' : 'y2'
    const y = points.map(point => stat.transform(point.values[index] ?? 0))
    const label = seriesCount === 2 ? stat.labels[key] : undefined
    const hovertemplate =
      label != null
        ? `%{x|%d %b %Y}<br>${label}: %{y}<extra></extra>`
        : '%{x|%d %b %Y}<br>%{y}<extra></extra>'
    // Round-3 (2026-09-01): line charts are the default — the X-axis is
    // time (a date) and each point is a day, per the user's expectation.
    // Opt into bar charts with `chartType: 'bar'`.
    const isLine = stat.chartType !== 'bar'
    const trace: Record<string, unknown> = {
      x,
      y,
      type: isLine ? 'line' : 'bar',
      name: label,
      showlegend: seriesCount === 2,
      hovertemplate,
    }
    if (isLine) {
      trace.line = { color: stat.colors[key] }
    } else {
      trace.marker = { color: stat.colors[key] }
    }
    return trace
  })
}

function buildLayout(stat: StatConfig, points: SeriesPoint[]) {
  const seriesCount = getSeriesCount(stat, points)
  const indexes = seriesCount === 2 ? [0, 1] : [0]
  const isLine = stat.chartType !== 'bar'
  // For bar/stacked charts scale the axis to the stacked total; for line
  // charts scale to the max of each series.
  const totals = points.map(point =>
    indexes.reduce((sum, index) => sum + (point.values[index] ?? 0), 0)
  )
  const seriesMaxs = indexes.map(index =>
    Math.max(
      0,
      ...points.map(point => stat.transform(point.values[index] ?? 0))
    )
  )
  const ymax = isLine
    ? Math.max(...seriesMaxs)
    : Math.max(0, ...totals.map(stat.transform))
  return {
    title: { text: stat.title },
    font: { family: 'Raleway, sans-serif' },
    bargap: 0.1,
    xaxis: {
      title: 'Time',
      type: 'date',
      tickmode: 'auto',
      nticks: 8,
      ticklabelmode: 'period',
      hoverformat: '%d %b %Y',
      automargin: true,
      tickformatstops: [
        { dtickrange: [null, 24 * 60 * 60 * 1000], value: '%d %b' },
        { dtickrange: [24 * 60 * 60 * 1000, 'M1'], value: '%d %b' },
        { dtickrange: ['M1', 'M12'], value: '%b %Y' },
        { dtickrange: ['M12', null], value: '%Y' },
      ],
    },
    yaxis: {
      title: { text: stat.ylabel || '' },
      range: [0, ymax],
    },
    barmode: isLine ? 'group' : 'stack',
  }
}

export async function renderChart(stat: StatConfig, points: SeriesPoint[]) {
  if (!window.Plotly) {
    throw new Error('Plotly is not available on window')
  }
  const traces = buildTraces(stat, points)
  const layout = buildLayout(stat, points)

  // Line charts render directly; bar charts animate from a zero baseline.
  const isLine = stat.chartType !== 'bar'
  const initialTraces =
    isLine
      ? traces
      : traces.map(trace => ({
          ...trace,
          y: (trace.y as number[]).map(() => 0),
        }))

  await window.Plotly.newPlot(stat.id, initialTraces, layout, {
    displayModeBar: false,
  })

  if (isLine) {
    return undefined
  }

  if (typeof window.Plotly.animate === 'function') {
    return window.Plotly.animate(
      stat.id,
      {
        data: traces.map(trace => ({ y: trace.y })),
      },
      {
        transition: { duration: 450, easing: 'cubic-in-out' },
        frame: { duration: 450, redraw: false },
      }
    )
  }

  return undefined
}
