/**
 * dumbbell.ts — before/after per category on a shared axis: a dot for each
 * value, joined by a bar colored by the direction of the change.
 *
 *   {"type":"dumbbell","labels":["2023","2025"],"data":[["España",3.5,2.0],["Francia",4.0,2.4]]}
 *   {"type":"dumbbell","series":[{"name":"2023","data":{...}},{"name":"2025","data":{...}}]}
 */
import { fmtValue, tickFormatter } from "../format"
import { CellGrid } from "../grid"
import { legend, noteRows, placeXLabels } from "../layout"
import { niceDomain } from "../scale"
import { clampInt, num, str } from "../spec"
import { strWidth, truncate } from "../text"
import { seriesColor } from "../theme"
import type { ChartResult, Ctx, Row, Spec } from "../types"
import { readTable, sortTable } from "./bar"

type Pair = { label: string; from: number; to: number }

function readPairs(spec: Spec): { pairs: Pair[]; names: [string, string] } {
  const d = spec.data
  const labels: unknown[] = Array.isArray(spec.labels) ? spec.labels : []
  const names: [string, string] = [str(labels[0], str(spec.from, "before")), str(labels[1], str(spec.to, "after"))]
  // rows of [label, from, to] or {label, from, to}
  if (Array.isArray(d) && d.length > 0 && d.every((r: unknown) => (Array.isArray(r) && r.length >= 3) || (r && typeof r === "object" && !Array.isArray(r)))) {
    const pairs = d
      .map((r: unknown): Pair | undefined => {
        if (Array.isArray(r)) {
          const from = num(r[1])
          const to = num(r[2])
          return from === null || to === null ? undefined : { label: str(r[0]), from, to }
        }
        const o = r as Record<string, unknown>
        const from = num(o.from ?? o.before ?? o.start ?? o.a)
        const to = num(o.to ?? o.after ?? o.end ?? o.b)
        return from === null || to === null ? undefined : { label: str(o.label ?? o.name), from, to }
      })
      .filter((p: Pair | undefined): p is Pair => !!p)
    return { pairs, names }
  }
  // two series
  const t = sortTable(readTable(spec), spec.sort === true ? "desc" : spec.sort)
  if (t.series.length < 2) throw new Error('dumbbell: expected "data":[["label", before, after],...] or two "series"')
  const [a, b] = t.series
  const pairs = t.cats
    .map((label, i) => ({ label, from: a!.values[i], to: b!.values[i] }))
    .filter((p): p is Pair => p.from !== null && p.to !== null)
  return { pairs, names: [a!.name, b!.name] }
}

export function renderDumbbell(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const { pairs, names } = readPairs(spec)
  if (pairs.length === 0) throw new Error('dumbbell: expected "data":[["label", before, after],...]')
  const width = Math.min(ctx.width, clampInt(spec.width, 24, 400, ctx.width), 120)
  const cFrom = seriesColor(theme, 0, Array.isArray(spec.colors) ? spec.colors[0] : undefined)
  const cTo = seriesColor(theme, 1, Array.isArray(spec.colors) ? spec.colors[1] : undefined)
  // higher is better unless the spec says lower is (rates, costs, latency)
  const goodUp = spec.lowerIsBetter !== true && spec.goodDirection !== "down"

  const all = pairs.flatMap((p) => [p.from, p.to])
  const texts = pairs.map((p) => `${fmtValue(p.from, unitStr)} → ${fmtValue(p.to, unitStr)}`)
  const textW = Math.max(...texts.map(strWidth))
  let labelW = Math.min(20, Math.max(...pairs.map((p) => strWidth(p.label))))
  let plotW = width - labelW - 1 - 2 - textW
  if (plotW < 10) {
    labelW = Math.max(3, labelW - (10 - plotW))
    plotW = Math.max(6, width - labelW - 3 - textW)
  }
  const domain = niceDomain(Math.min(...all), Math.max(...all), Math.max(2, Math.floor(plotW / 12)))
  const col = (v: number) => Math.max(0, Math.min(plotW - 1, Math.round(((v - domain.lo) / (domain.hi - domain.lo)) * (plotW - 1))))
  const x0 = labelW + 1

  const grid = new CellGrid(width, pairs.length + 2)
  pairs.forEach((p, y) => {
    grid.text(0, y, truncate(p.label, labelW), theme.text)
    const a = col(p.from)
    const b = col(p.to)
    const better = p.to === p.from ? undefined : p.to > p.from === goodUp
    const bar = better === undefined ? theme.muted : better ? theme.up : theme.down
    for (let c = Math.min(a, b) + 1; c < Math.max(a, b); c++) grid.set(x0 + c, y, "━", bar)
    grid.set(x0 + a, y, "●", cFrom)
    grid.set(x0 + b, y, "●", cTo)
    grid.textRight(width, y, texts[y]!, better === undefined ? theme.text : bar)
  })

  const axisY = pairs.length
  for (let c = 0; c < plotW; c++) grid.set(x0 + c, axisY, "─", theme.muted)
  const f = tickFormatter(domain.ticks, domain.step, unitStr)
  for (const l of placeXLabels(domain.ticks.map((t) => ({ col: col(t), label: f(t) })), plotW)) {
    grid.set(x0 + l.col, axisY, "┬", theme.muted)
    grid.text(x0 + l.start, axisY + 1, l.label, theme.muted)
  }

  const notes = noteRows(spec, width, theme)
  const top: Row[] = [...notes.top]
  if (spec.legend !== false) {
    top.push(...legend([{ label: names[0], color: cFrom }, { label: names[1], color: cTo }], width, theme))
  }
  return { title: str(spec.title) || undefined, rows: [...top, ...grid.rows(), ...notes.bottom] }
}
