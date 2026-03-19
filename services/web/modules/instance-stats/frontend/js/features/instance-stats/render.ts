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
    return {
      x,
      y,
      type: 'bar',
      name: seriesCount === 2 ? stat.labels[key] : undefined,
      showlegend: seriesCount === 2,
      marker: { color: stat.colors[key] },
    }
  })
}

function buildLayout(stat: StatConfig, points: SeriesPoint[]) {
  const seriesCount = getSeriesCount(stat, points)
  const indexes = seriesCount === 2 ? [0, 1] : [0]
  const totals = points.map(point =>
    indexes.reduce((sum, index) => sum + (point.values[index] ?? 0), 0)
  )
  const ymax = totals.length > 0 ? Math.max(...totals.map(stat.transform)) : 0
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
    barmode: 'stack',
  }
}

export async function renderChart(stat: StatConfig, points: SeriesPoint[]) {
  if (!window.Plotly) {
    throw new Error('Plotly is not available on window')
  }
  const traces = buildTraces(stat, points)
  const layout = buildLayout(stat, points)
  const initialTraces = traces.map(trace => ({
    ...trace,
    y: (trace.y as number[]).map(() => 0),
  }))

  await window.Plotly.newPlot(stat.id, initialTraces, layout, {
    displayModeBar: false,
  })

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

