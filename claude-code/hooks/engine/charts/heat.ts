/**
 * heat.ts — matrix heatmap (colored cell backgrounds, values printed when they
 * fit) and the GitHub-style calendar heatmap for daily data.
 * Data containing both signs switches to a diverging scale centered on 0.
 */
import { dataDecimals, fmtValue, tickFormatter } from "../format"
import { CellGrid } from "../grid"
import { flow, noteRows, placeXLabels, stat } from "../layout"
import { clampInt, isNum, num, parseDate, readSeries, str } from "../spec"
import { center, strWidth, truncate } from "../text"
import { diverging, isHex, mix, readableOn, sequential } from "../theme"
import type { ChartResult, Ctx, Row, Run, Spec, Theme } from "../types"

const MAX_WIDTH = 160

type Matrix = { z: (number | null)[][]; xLabels: string[]; yLabels: string[] }

function readMatrix(spec: Spec): Matrix {
  const xl = (spec.xLabels ?? spec.columns ?? spec.cols ?? spec.x) as unknown
  const yl = (spec.yLabels ?? spec.rows ?? spec.y) as unknown
  const zRaw = spec.z ?? spec.matrix ?? spec.values
  if (Array.isArray(zRaw) && zRaw.every(Array.isArray)) {
    const z = zRaw.map((r: unknown[]) => r.map(num))
    const cols = Math.max(...z.map((r) => r.length))
    return {
      z,
      xLabels: Array.from({ length: cols }, (_, i) => (Array.isArray(xl) && xl[i] !== undefined ? String(xl[i]) : String(i + 1))),
      yLabels: z.map((_, i) => (Array.isArray(yl) && yl[i] !== undefined ? String(yl[i]) : String(i + 1))),
    }
  }
  const d = spec.data
  // long format: [[x, y, value], ...] or [{x, y, value}]
  if (Array.isArray(d) && d.length > 0) {
    const triples = d
      .map((t: unknown) => {
        if (Array.isArray(t) && t.length >= 3) return [String(t[0]), String(t[1]), num(t[2])] as const
        if (t && typeof t === "object") {
          const o = t as Record<string, unknown>
          return [String(o.x ?? o.col ?? o.column), String(o.y ?? o.row), num(o.value ?? o.v ?? o.z)] as const
        }
        return undefined
      })
      .filter((t): t is readonly [string, string, number | null] => !!t)
    const xs = [...new Set(triples.map((t) => t[0]))]
    const ys = [...new Set(triples.map((t) => t[1]))]
    const z = ys.map(() => xs.map((): number | null => null))
    for (const [x, y, v] of triples) z[ys.indexOf(y)][xs.indexOf(x)] = v
    return { z, xLabels: xs, yLabels: ys }
  }
  // nested map: {row: {col: value}}
  if (d && typeof d === "object" && Object.values(d).every((r) => r && typeof r === "object" && !Array.isArray(r))) {
    const ys = Object.keys(d)
    const xs = [...new Set(ys.flatMap((y) => Object.keys(d[y])))]
    return { z: ys.map((y) => xs.map((x) => num(d[y][x]))), xLabels: xs, yLabels: ys }
  }
  throw new Error('heat: expected "z":[[row values],...] with "xLabels"/"yLabels", or "data":[[x, y, value],...]')
}

function colorScale(values: number[], theme: Theme, spec: Spec): { color: (v: number) => string; lo: number; hi: number; div: boolean } {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const div = spec.diverging === true || (spec.diverging !== false && lo < 0 && hi > 0)
  if (div) {
    const c = num(spec.center) ?? 0
    const m = Math.max(Math.abs(lo - c), Math.abs(hi - c)) || 1
    const f = diverging(theme)
    return { color: (v) => f((v - c) / m), lo: c - m, hi: c + m, div }
  }
  const f = isHex(spec.color) ? (t: number) => mix(mix(theme.background, spec.color, 0.2), spec.color, t) : sequential(theme)
  const span = hi - lo || 1
  return { color: (v) => f((v - lo) / span), lo, hi, div }
}

function legendRow(scale: ReturnType<typeof colorScale>, unitStr: string, indent: number, theme: Theme, width: number): Row {
  const lo = `${fmtValue(scale.lo, unitStr)} `
  const hi = ` ${fmtValue(scale.hi, unitStr)}`
  if (indent + lo.length + hi.length + 4 > width) indent = 0
  const steps = Math.max(2, Math.min(16, width - indent - lo.length - hi.length))
  const runs: Run[] = [{ text: " ".repeat(indent) }, { text: lo, fg: theme.muted }]
  for (let i = 0; i < steps; i++) {
    const v = scale.lo + ((scale.hi - scale.lo) * i) / (steps - 1)
    runs.push({ text: "█", fg: scale.color(v) })
  }
  runs.push({ text: hi, fg: theme.muted })
  return runs
}

export function renderHeat(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const m = readMatrix(spec)
  let { z, xLabels } = m
  const { yLabels } = m
  const values = z.flat().filter(isNum)
  if (values.length === 0) throw new Error("heat: no numeric values")
  const unitStr = str(spec.unit)
  const width = Math.min(ctx.width, clampInt(spec.width, 20, 400, ctx.width), MAX_WIDTH)
  const scale = colorScale(values, theme, spec)
  const maxAbs = Math.max(...values.map(Math.abs))
  const minAbs = Math.min(...values.filter((v) => v !== 0).map(Math.abs), maxAbs)
  let fmt: (v: number) => string
  if (num(spec.decimals) !== null) {
    const d = Math.max(0, Math.min(6, num(spec.decimals)!))
    fmt = (v) => v.toFixed(d)
  } else if (maxAbs >= 1e4 || maxAbs < 0.01 || maxAbs / minAbs > 1e4) {
    // big or mixed magnitudes: each cell gets its own compact form (12.3k, 2M, 7)
    fmt = (v) => fmtValue(v, "", { compact: true })
  } else {
    // shared decimals keep the columns aligned (6.2, -2.6, 0.3)
    fmt = tickFormatter(values, 10 ** -dataDecimals(values, maxAbs < 1 ? 3 : maxAbs < 100 ? 2 : 1))
  }

  const yW = Math.min(16, Math.max(...yLabels.map(strWidth))) + 1
  const avail = width - yW
  let cols = Math.max(...z.map((r) => r.length))
  const valW = Math.max(...values.map((v) => strWidth(fmt(v))))
  const xlW = Math.min(8, Math.max(...xLabels.map(strWidth)))

  let cellW = Math.max(valW + 2, xlW + 1)
  let showValues = spec.values !== false
  if (cols * cellW > avail) cellW = valW + 1
  if (cols * cellW > avail || !showValues) {
    showValues = showValues && cols * cellW <= avail
    if (!showValues) cellW = Math.max(1, Math.min(4, Math.floor(avail / cols)))
  }
  const bottom: Row[] = []
  if (cols * cellW > avail) {
    const keep = Math.max(1, Math.floor(avail / cellW))
    bottom.push([{ text: truncate(`showing last ${keep} of ${cols} columns`, width), fg: theme.muted }])
    z = z.map((r) => r.slice(Math.max(0, cols - keep)))
    xLabels = xLabels.slice(Math.max(0, cols - keep))
    cols = keep
  }

  const grid = new CellGrid(width, z.length + 1)
  // header
  const labels = placeXLabels(
    xLabels.map((l, i) => ({ col: i * cellW + Math.floor(cellW / 2), label: l })),
    cols * cellW,
    Math.max(cellW - 1, 8),
  )
  if (showValues && xlW <= cellW - 1) {
    xLabels.forEach((l, i) => grid.text(yW + i * cellW, 0, center(truncate(l, cellW - 1), cellW), theme.muted))
  } else for (const l of labels) grid.text(yW + l.start, 0, l.label, theme.muted)

  z.forEach((row, r) => {
    grid.text(0, r + 1, truncate(yLabels[r] ?? "", yW - 1), theme.text)
    for (let c = 0; c < cols; c++) {
      const v = row[c]
      const x = yW + c * cellW
      if (!isNum(v)) {
        grid.text(x, r + 1, center("·", cellW), theme.grid)
        continue
      }
      const bg = scale.color(v)
      const txt = showValues ? center(fmt(v), cellW) : " ".repeat(cellW)
      grid.text(x, r + 1, txt, readableOn(bg, theme), { bg })
    }
  })

  const notes = noteRows(spec, width, theme)
  const legend = spec.legend === false ? [] : [legendRow(scale, unitStr, yW, theme, width)]
  return { title: str(spec.title) || undefined, rows: [...notes.top, ...grid.rows(), ...legend, ...bottom, ...notes.bottom] }
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""]

function isoDay(d: number): string {
  return new Date(d * DAY).toISOString().slice(0, 10)
}

export function renderCalendar(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const width = Math.min(ctx.width, clampInt(spec.width, 20, 400, ctx.width), MAX_WIDTH)
  const byDay = new Map<number, number>()
  for (const s of readSeries(spec)) {
    for (const [l, v] of s.pairs) {
      const t = parseDate(String(l))
      if (t === undefined || v === null) continue
      const d = Math.floor(t / DAY)
      byDay.set(d, (byDay.get(d) ?? 0) + v)
    }
  }
  if (byDay.size === 0) throw new Error('calendar: expected "data":[["2026-01-31", value],...] with YYYY-MM-DD dates')

  const days = [...byDay.keys()]
  const first = Math.min(...days)
  const last = Math.max(...days)
  const dow = (d: number) => (new Date(d * DAY).getUTCDay() + 6) % 7
  const labelW = 4
  const cellW = 2
  let start = first - dow(first)
  let weeks = Math.floor((last - start) / 7) + 1
  const maxWeeks = Math.max(1, Math.floor((width - labelW) / cellW))
  const bottom: Row[] = []
  if (weeks > maxWeeks) {
    start += (weeks - maxWeeks) * 7
    bottom.push([{ text: truncate(`showing last ${maxWeeks} of ${weeks} weeks`, width), fg: theme.muted }])
    weeks = maxWeeks
  }

  const vals = [...byDay.entries()].filter(([d]) => d >= start).map(([, v]) => v)
  const neg = vals.some((v) => v < 0)
  const pos = vals.some((v) => v > 0)
  const div = neg && pos
  const base = isHex(spec.color) ? spec.color : theme.up
  const maxAbs = Math.max(...vals.map(Math.abs)) || 1
  const maxV = Math.max(...vals)
  const minV = Math.min(...vals)
  const divF = diverging(theme)
  const colorFor = (v: number) => {
    if (div) return divF(v / maxAbs)
    const t = neg ? (maxV - v) / (maxV - minV || 1) : (v - Math.min(0, minV)) / (maxV - Math.min(0, minV) || 1)
    return mix(mix(theme.background, base, 0.25), base, t)
  }

  const grid = new CellGrid(width, 8)
  WEEKDAYS.forEach((d, i) => grid.text(0, i + 1, d, theme.muted))
  let lastMonth = -1
  let freeFrom = 0
  for (let w = 0; w < weeks; w++) {
    const x = labelW + w * cellW
    for (let i = 0; i < 7; i++) {
      const d = start + w * 7 + i
      if (d < first || d > last) continue
      const v = byDay.get(d)
      if (v === undefined) grid.set(x, i + 1, "·", theme.grid)
      else if (v === 0 && !div) grid.set(x, i + 1, "■", theme.grid)
      else grid.set(x, i + 1, "■", colorFor(v))
    }
    const month = new Date((start + w * 7) * DAY).getUTCMonth()
    if (month !== lastMonth) {
      const name = MONTHS[month]
      if (x >= freeFrom && x + name.length <= width) {
        grid.text(x, 0, name, theme.muted)
        freeFrom = x + name.length + 1
      }
      lastMonth = month
    }
  }

  const items: Run[][] = []
  const shown = [...byDay.entries()].filter(([d]) => d >= start)
  const total = shown.reduce((a, [, v]) => a + v, 0)
  const best = shown.reduce((a, b) => (b[1] > a[1] ? b : a))
  const worst = shown.reduce((a, b) => (b[1] < a[1] ? b : a))
  items.push(stat("days", String(shown.length), theme))
  items.push(stat("total", fmtValue(total, unitStr), theme))
  items.push(stat("max", `${fmtValue(best[1], unitStr)} ${isoDay(best[0])}`, theme))
  if (div) items.push(stat("min", `${fmtValue(worst[1], unitStr)} ${isoDay(worst[0])}`, theme))

  const legendW = (div ? 4 + 10 + 3 : 5 + 8 + 4) + labelW
  const legend: Run[] = [{ text: " ".repeat(legendW <= width ? labelW : 0) }, { text: div ? "neg " : "less ", fg: theme.muted }]
  const levels = div ? [-1, -0.5, 0, 0.5, 1].map((t) => divF(t)) : [0, 0.33, 0.66, 1].map((t) => mix(mix(theme.background, base, 0.25), base, t))
  for (const c of levels) legend.push({ text: "■ ", fg: c })
  legend.push({ text: div ? "pos" : "more", fg: theme.muted })

  const notes = noteRows(spec, width, theme)
  return {
    title: str(spec.title) || undefined,
    rows: [...notes.top, ...grid.rows(), legend, ...(spec.stats === false ? [] : flow(items, width)), ...bottom, ...notes.bottom],
  }
}
