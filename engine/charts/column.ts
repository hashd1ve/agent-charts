/**
 * column.ts — vertical bars (single, grouped, stacked) and histograms.
 * Bar tops use lower eighth blocks; where two stacked segments meet inside a
 * cell the glyph's fg is the lower segment and its bg the upper one.
 */
import { LOWER_EIGHTHS, vbarDown } from "../canvas"
import { fmtValue, tickFormatter } from "../format"
import { CellGrid } from "../grid"
import { type XCand, drawXAxis, drawYAxis, flow, gutterWidth, legend, noteRows, placeXLabels, stat, yMarks } from "../layout"
import { niceDomain, niceStep, unit } from "../scale"
import { clampInt, isNum, num, optNum, readSeries, str } from "../spec"
import { strWidth, truncate } from "../text"
import { seriesColor } from "../theme"
import type { ChartResult, Ctx, Row, Run, Spec, Theme } from "../types"
import { readTable, sortTable } from "./bar"

const MAX_WIDTH = 140

type Seg = { h: number; color: string }

/** Stack of segments growing up from the bottom of `baseRow` (heights in rows). */
function vstack(grid: CellGrid, x: number, w: number, baseRow: number, segs: Seg[]): void {
  const parts = segs.filter((s) => s.h > 0)
  if (parts.length === 0) return
  const bounds: number[] = []
  let acc = 0
  for (const p of parts) {
    acc += p.h
    bounds.push(acc)
  }
  const total = acc
  const colorAt = (h: number) => {
    const i = bounds.findIndex((b) => h < b - 1e-9)
    return parts[i === -1 ? parts.length - 1 : i].color
  }
  const rows = Math.ceil(total - 1e-9)
  for (let r = 0; r < Math.max(1, rows); r++) {
    const bottomColor = colorAt(r + 1e-6)
    const cellTop = Math.min(total, r + 1)
    const topColor = colorAt(cellTop - 1e-6)
    let ch: string
    let fg = bottomColor
    let bg: string | undefined
    if (total >= r + 1 - 1e-9) {
      if (bottomColor === topColor) ch = "█"
      else {
        const boundary = bounds.find((b) => b > r + 1e-9 && b < r + 1 - 1e-9) ?? r + 1
        const k = Math.round((boundary - r) * 8)
        if (k <= 0) {
          ch = "█"
          fg = topColor
        } else if (k >= 8) ch = "█"
        else {
          ch = LOWER_EIGHTHS[k]
          bg = topColor
        }
      }
    } else {
      const k = Math.max(1, Math.round((cellTop - r) * 8))
      ch = LOWER_EIGHTHS[Math.min(8, k)]
      fg = topColor
    }
    for (let dx = 0; dx < w; dx++) grid.set(x + dx, baseRow - r, ch, fg, bg)
  }
}

type ColumnInput = {
  cats: string[]
  series: { name: string; color: string; values: (number | null)[] }[]
  stacked: boolean
  unit: string
  H: number
  width: number
  theme: Theme
  hist?: { edges: number[]; step: number; xUnit: string }
  showValues?: boolean
  yMin?: number
  yMax?: number
  integer?: boolean
}

function drawColumns(o: ColumnInput): { rows: Row[]; plotW: number } {
  const { cats, series, stacked, theme, H } = o
  const k = stacked ? 1 : series.length
  let lo = 0
  let hi = 0
  cats.forEach((_, i) => {
    if (stacked) {
      let pos = 0
      let neg = 0
      for (const s of series) {
        const v = s.values[i] ?? 0
        if (v >= 0) pos += v
        else neg += v
      }
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    } else
      for (const s of series) {
        const v = s.values[i]
        if (v !== null) {
          hi = Math.max(hi, v)
          lo = Math.min(lo, v)
        }
      }
  })
  // one spare row above the tallest bar so value labels can sit on top
  const head = (o.showValues ?? true) && !o.hist && hi > 0 ? (hi - lo) / Math.max(1, H - 1) : 0
  // a stack must start at zero: a positive yMin would cut its first segment
  const yMin = stacked && o.yMin !== undefined && o.yMin > 0 ? undefined : o.yMin
  const domain = niceDomain(lo, hi + head, Math.max(1, Math.floor(H / 2)), { zero: true, fixedLo: yMin, fixedHi: o.yMax, integer: o.integer })
  const marks = yMarks(domain, H, 8, o.unit)
  const gutter = gutterWidth(marks)
  const plotW = Math.max(4, o.width - gutter - 1)
  const n = cats.length
  const slot = Math.max(1, Math.floor(plotW / n))
  const gap = o.hist ? 0 : slot >= 3 * k ? Math.max(1, Math.round(slot * 0.25)) : slot > k ? 1 : 0
  const bw = Math.max(1, Math.floor((slot - gap) / k))
  const used = slot * n
  const xOff = Math.floor((plotW - used) / 2)

  const grid = new CellGrid(o.width, H + 2)
  // bars grow from zero, or from the nearest domain edge when yMin/yMax exclude it
  const u0 = unit(domain, Math.min(Math.max(0, domain.lo), domain.hi))
  const zRow = Math.round(u0 * H) // rows of plot below the baseline
  const base = H - 1 - zRow // grid row whose bottom edge is the baseline
  const upRoom = H - zRow
  const downRoom = zRow
  const left = gutter + 1 + xOff

  // horizontal guides at the ticks (drawn first; bars overwrite them)
  for (const m of marks) {
    if (m.value === 0 && domain.lo === 0) continue
    for (let c = 0; c < plotW; c++) grid.set(gutter + 1 + c, m.row, "┈", theme.grid)
  }

  const valueLabels: { x: number; y: number; text: string; color: string }[] = []
  cats.forEach((_, i) => {
    const slotX = left + i * slot + Math.floor((slot - bw * k) / 2)
    if (stacked) {
      const pos: Seg[] = []
      const neg: Seg[] = []
      for (const s of series) {
        const v = s.values[i] ?? 0
        const h = (Math.abs(v) / (domain.hi - domain.lo)) * H
        if (v > 0) pos.push({ h, color: s.color })
        else if (v < 0) neg.push({ h, color: s.color })
      }
      vstack(grid, slotX, bw, base, pos)
      let down = 0
      for (const sgm of neg) {
        vbarDown(grid, slotX, base + 1 + Math.floor(down), sgm.h, sgm.color, bw)
        down += sgm.h
      }
      const total = series.reduce((a, s) => a + (s.values[i] ?? 0), 0)
      const top = pos.reduce((a, p) => a + p.h, 0)
      valueLabels.push({ x: slotX, y: base - Math.ceil(top - 1e-9), text: fmtValue(total, o.unit, { compact: true }), color: theme.text })
      return
    }
    series.forEach((s, si) => {
      const v = s.values[i]
      if (v === null) return
      const x = slotX + si * bw
      const raw = (unit(domain, v) - u0) * H
      const h = Math.max(0, Math.min(raw >= 0 ? upRoom : downRoom, Math.abs(raw)))
      if (raw >= 0) {
        vstack(grid, x, bw, base, [{ h, color: s.color }])
        valueLabels.push({ x, y: base - Math.ceil(h - 1e-9), text: fmtValue(v, o.unit, { compact: true }), color: k > 1 ? s.color : theme.text })
      } else {
        vbarDown(grid, x, base + 1, h, s.color, bw)
        valueLabels.push({ x, y: base + 1 + Math.ceil(h - 1e-9), text: fmtValue(v, o.unit, { compact: true }), color: k > 1 ? s.color : theme.text })
      }
    })
  })

  drawYAxis(grid, marks, gutter, 0, H, theme)

  // value labels on top of bars, only when every one of them fits
  if ((o.showValues ?? true) && !o.hist && valueLabels.length <= 40) {
    const room = k === 1 ? slot - (gap > 0 ? 1 : 0) : bw
    if (valueLabels.every((l) => strWidth(l.text) <= room && l.y >= 0 && l.y < H)) {
      for (const l of valueLabels) {
        const x = Math.max(gutter + 1, l.x + Math.floor((bw - strWidth(l.text)) / 2))
        grid.text(x, l.y, l.text, l.color)
      }
    }
  }

  // x axis
  let cands: XCand[]
  if (o.hist) {
    const f = tickFormatter(o.hist.edges, o.hist.step, o.hist.xUnit)
    cands = o.hist.edges.map((e, i) => ({ col: xOff + i * slot, label: f(e) }))
  } else {
    cands = cats.map((c, i) => ({ col: xOff + i * slot + Math.floor(slot / 2), label: c }))
  }
  drawXAxis(grid, H, gutter, plotW, placeXLabels(cands, plotW, 10), theme)
  return { rows: grid.rows(), plotW }
}

export function renderColumn(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const stacked = spec.stacked === true || spec.stack === true
  const table = sortTable(readTable(spec), spec.sort === true ? "desc" : spec.sort)
  const width = Math.min(ctx.width, clampInt(spec.width, 20, 400, ctx.width), MAX_WIDTH)
  const multi = table.series.length > 1
  const colors = table.series.map((s, i) => seriesColor(theme, i, s.color ?? (!multi ? spec.color : undefined)))
  let { cats } = table
  let series = table.series.map((s, i) => ({ name: s.name, color: colors[i], values: s.values }))
  const notes = noteRows(spec, width, theme)
  const bottom: Row[] = []

  // more columns than cells: keep the most recent ones
  const k = stacked ? 1 : series.length
  const room = Math.max(1, Math.floor((width - 8) / k))
  if (cats.length > room) {
    const drop = cats.length - room
    bottom.push([{ text: truncate(`showing last ${room} of ${cats.length} columns`, width), fg: theme.muted }])
    cats = cats.slice(drop)
    series = series.map((s) => ({ ...s, values: s.values.slice(drop) }))
  }

  const { rows } = drawColumns({
    cats,
    series,
    stacked,
    unit: str(spec.unit),
    H: clampInt(spec.height, 3, 40, 10),
    width,
    theme,
    showValues: spec.values !== false,
    yMin: optNum(spec.yMin ?? spec.min),
    yMax: optNum(spec.yMax ?? spec.max),
  })
  const top: Row[] = [...notes.top]
  if (multi && spec.legend !== false) top.push(...legend(series.map((s) => ({ label: s.name, color: s.color })), width, theme))
  return { title: str(spec.title) || undefined, rows: [...top, ...rows, ...bottom, ...notes.bottom] }
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

export function readValues(spec: Spec): number[] {
  const d = spec.data ?? spec.values
  if (Array.isArray(d) && d.every((v) => !Array.isArray(v) && (v === null || typeof v !== "object"))) {
    return d.map(num).filter(isNum)
  }
  return readSeries(spec).flatMap((s) => s.pairs.map((p) => p[1]).filter(isNum))
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  const pos = (sorted.length - 1) * q
  const i = Math.floor(pos)
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * (pos - i) : sorted[i]
}

export function renderHist(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const values = readValues(spec)
  if (values.length === 0) throw new Error('hist: expected "data":[numbers]')
  const unitStr = str(spec.unit)
  const width = Math.min(ctx.width, clampInt(spec.width, 20, 400, ctx.width), MAX_WIDTH)
  const lo = Math.min(...values)
  const hi = Math.max(...values)

  const maxBins = Math.max(2, Math.floor((width - 8) / 2))
  const span = hi - lo || Math.abs(lo) || 1
  const binning = (t: number) => {
    const step = niceStep(span, t)
    const start = Math.floor(lo / step + 1e-9) * step
    return { step, start, nb: Math.max(1, Math.ceil((hi - start) / step - 1e-9)) }
  }
  let t = Math.min(maxBins, clampInt(spec.bins, 2, 200, Math.max(5, Math.min(24, Math.round(Math.sqrt(values.length) * 1.5)))))
  let { step, start, nb } = binning(t)
  while (nb > maxBins && t > 1) {
    t = Math.floor(t / 2)
    ;({ step, start, nb } = binning(t))
  }
  const counts = new Array<number>(nb).fill(0)
  for (const v of values) counts[Math.min(nb - 1, Math.max(0, Math.floor((v - start) / step + 1e-9)))]++
  const edges = Array.from({ length: nb + 1 }, (_, i) => Number((start + i * step).toPrecision(12)))

  const { rows } = drawColumns({
    cats: counts.map((_, i) => String(i)),
    series: [{ name: "count", color: seriesColor(theme, 0, spec.color), values: counts }],
    stacked: false,
    unit: "",
    H: clampInt(spec.height, 3, 40, 10),
    width,
    theme,
    hist: { edges, step, xUnit: unitStr },
    integer: true,
  })

  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = values.length > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)) : 0
  const items: Run[][] = [
    stat("n", String(values.length), theme),
    stat("mean", fmtValue(mean, unitStr), theme),
    stat("median", fmtValue(quantile(sorted, 0.5), unitStr), theme),
    stat("σ", fmtValue(sd, unitStr), theme),
  ]
  const notes = noteRows(spec, width, theme)
  return {
    title: str(spec.title) || undefined,
    rows: [...notes.top, ...rows, ...(spec.stats === false ? [] : flow(items, width)), ...notes.bottom],
  }
}
