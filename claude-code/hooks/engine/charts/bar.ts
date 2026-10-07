/**
 * bar.ts — horizontal bars (single, grouped, stacked, 100% stacked) and the
 * waterfall/bridge chart, all with eighth-of-a-cell precision.
 */
import { hbar } from "../canvas"
import { fmtValue } from "../format"
import { CellGrid } from "../grid"
import { legend, noteRows } from "../layout"
import { clampInt, num, readSeries, sortByDate, str } from "../spec"
import { strWidth, truncate } from "../text"
import { isHex, seriesColor } from "../theme"
import type { ChartResult, Ctx, Row, Spec } from "../types"

const MAX_WIDTH = 120

type Table = { cats: string[]; series: { name: string; color?: string; values: (number | null)[] }[] }

/** Categories in first-appearance order × series. */
export function readTable(spec: Spec): Table {
  const raw = readSeries(spec)
  const index = new Map<string, number>()
  for (const s of raw) for (const [l] of s.pairs) if (!index.has(String(l))) index.set(String(l), index.size)
  const cats = sortByDate([...index.keys()], (c) => c)
  index.clear()
  cats.forEach((c, i) => index.set(c, i))
  const series = raw.map((s) => {
    const values: (number | null)[] = new Array(cats.length).fill(null)
    for (const [l, v] of s.pairs) values[index.get(String(l))!] = v
    return { name: s.name, color: s.color, values }
  })
  return { cats, series }
}

export function sortTable(t: Table, how: unknown): Table {
  if (!how) return t
  const dir = how === "asc" ? 1 : -1
  const total = (i: number) => t.series.reduce((a, s) => a + (s.values[i] ?? 0), 0)
  const order = t.cats.map((_, i) => i).sort((a, b) => dir * (total(a) - total(b)))
  return { cats: order.map((i) => t.cats[i]), series: t.series.map((s) => ({ ...s, values: order.map((i) => s.values[i]) })) }
}

function highlightSet(spec: Spec): Set<string> | undefined {
  const h = spec.highlight
  if (h === undefined || h === null) return undefined
  return new Set((Array.isArray(h) ? h : [h]).map(String))
}

type Layout = { width: number; labelW: number; barW: number; valueW: number }

function layout(ctx: Ctx, spec: Spec, labels: string[], values: string[]): Layout {
  const width = Math.min(ctx.width, clampInt(spec.width, 24, 400, ctx.width), MAX_WIDTH)
  const valueW = Math.max(1, ...values.map(strWidth))
  let labelW = Math.min(Math.max(1, ...labels.map(strWidth)), 24, Math.max(4, Math.floor(width * 0.3)))
  let barW = width - labelW - 1 - 1 - valueW
  if (barW < 8) {
    labelW = Math.max(3, labelW - (8 - barW))
    barW = Math.max(4, width - labelW - 2 - valueW)
  }
  return { width, labelW, barW, valueW }
}

export function renderBar(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const percent = spec.percent === true || spec.normalize === true || spec.stacked === "percent"
  const stacked = percent || spec.stacked === true || spec.stack === true
  const table = sortTable(readTable(spec), spec.sort === true ? "desc" : spec.sort)
  const { cats, series } = table
  if (cats.length === 0) throw new Error("bar: no data")
  const multi = series.length > 1
  const colors = series.map((s, i) => seriesColor(theme, i, s.color ?? (!multi ? spec.color : undefined)))
  const hl = highlightSet(spec)

  /* ---- scale ---- */
  let lo = 0
  let hi = 0
  const totals = cats.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0))
  if (stacked) {
    cats.forEach((_, i) => {
      let pos = 0
      let neg = 0
      for (const s of series) {
        const v = s.values[i] ?? 0
        if (v >= 0) pos += v
        else neg += v
      }
      if (percent) {
        pos = pos > 0 ? 100 : 0
        neg = 0
      }
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    })
  } else {
    for (const s of series) for (const v of s.values) if (v !== null) {
      hi = Math.max(hi, v)
      lo = Math.min(lo, v)
    }
  }
  if (hi === lo) hi = lo + 1

  /* ---- rows to draw ---- */
  type Line = { label: string; value: string; valueColor?: string; draw: (g: CellGrid, x0: number, y: number, s: number, z: number) => void }
  const lines: Line[] = []
  const mixedSign = lo < 0 && hi > 0 && !multi

  cats.forEach((cat, i) => {
    const dim = hl && !hl.has(cat)
    if (stacked) {
      const parts = series.map((s, si) => ({ v: s.values[i] ?? 0, color: colors[si] }))
      const pos = parts.filter((p) => p.v > 0)
      const posSum = pos.reduce((a, p) => a + p.v, 0)
      lines.push({
        label: cat,
        value: fmtValue(totals[i], unitStr),
        draw: (g, x0, y, scale, zero) => {
          let acc = 0
          for (const p of pos) {
            const v = percent && posSum > 0 ? (p.v / posSum) * 100 : p.v
            hbar(g, x0, y, zero + acc * scale, zero + (acc + v) * scale, dim ? theme.grid : p.color)
            acc += v
          }
          if (!percent) {
            let nacc = 0
            for (const p of parts.filter((q) => q.v < 0)) {
              hbar(g, x0, y, zero + (nacc + p.v) * scale, zero + nacc * scale, dim ? theme.grid : p.color)
              nacc += p.v
            }
          }
        },
      })
      return
    }
    series.forEach((s, si) => {
      const v = s.values[i]
      const color = dim
        ? theme.grid
        : mixedSign && !isHex(spec.color)
          ? v !== null && v < 0
            ? theme.down
            : theme.up
          : colors[si]
      lines.push({
        label: si === 0 ? cat : "",
        value: v === null ? "–" : fmtValue(v, unitStr),
        valueColor: multi ? colors[si] : undefined,
        draw: (g, x0, y, scale, zero) => {
          if (v === null || v === 0) return
          if (v > 0) hbar(g, x0, y, zero, zero + v * scale, color)
          else hbar(g, x0, y, zero + v * scale, zero, color)
        },
      })
    })
  })

  const L = layout(ctx, spec, lines.map((l) => l.label), lines.map((l) => l.value))
  const scale = L.barW / (hi - lo)
  const zero = -lo * scale
  const grid = new CellGrid(L.width, lines.length)
  const x0 = L.labelW + 1
  lines.forEach((l, y) => {
    if (l.label) grid.text(0, y, truncate(l.label, L.labelW), hl && !hl.has(l.label) ? theme.muted : theme.text)
    l.draw(grid, x0, y, scale, zero)
    if (lo < 0) {
      const zc = x0 + Math.min(L.barW - 1, Math.floor(zero))
      if (grid.isBlank(zc, y)) grid.set(zc, y, "│", theme.grid)
    }
    grid.textRight(L.width, y, l.value, l.valueColor ?? theme.text)
  })

  const notes = noteRows(spec, L.width, theme)
  const top: Row[] = [...notes.top]
  if (multi && spec.legend !== false) top.push(...legend(series.map((s, i) => ({ label: s.name, color: colors[i] })), L.width, theme))
  return { title: str(spec.title) || undefined, rows: [...top, ...grid.rows(), ...notes.bottom] }
}

/* ------------------------------------------------------------------ */
/* Waterfall                                                           */
/* ------------------------------------------------------------------ */

type Step = { label: string; start: number; end: number; total: boolean; delta: number }

function isTotalMarker(v: unknown): boolean {
  return v === "=" || v === "total" || v === "subtotal" || v === true
}

export function renderWaterfall(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const structured = Array.isArray(spec.data) && spec.data.length > 0 && spec.data.every((d: unknown) => Array.isArray(d) || (d !== null && typeof d === "object"))
  let raw: unknown[] = []
  if (structured) raw = spec.data
  else {
    try {
      // bare numbers with "labels", {label: value} maps, Chart.js datasets…
      raw = readSeries(spec)[0].pairs.map(([l, v]) => [String(l), v])
    } catch {}
  }
  const usage = 'waterfall: expected "data":[["Start",100],["Price",12],["Cost",-5],...]'
  if (raw.length === 0) throw new Error(usage)

  const steps: Step[] = []
  let running = 0
  raw.forEach((item, i) => {
    let label: string
    let value: number | null
    let total = false
    if (Array.isArray(item)) {
      label = str(item[0], `#${i + 1}`)
      total = isTotalMarker(item[1]) || isTotalMarker(item[2])
      value = num(item[1])
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>
      label = str(o.label ?? o.name ?? o.x, `#${i + 1}`)
      total = isTotalMarker(o.total) || isTotalMarker(o.type) || isTotalMarker(o.value)
      value = num(o.value ?? o.y ?? o.delta)
    } else return
    if (total) {
      steps.push({ label, start: 0, end: running, total: true, delta: running })
    } else if (value !== null) {
      if (i === 0 && spec.start !== false) {
        steps.push({ label, start: 0, end: value, total: true, delta: value })
        running = value
      } else {
        steps.push({ label, start: running, end: running + value, total: false, delta: value })
        running += value
      }
    }
  })
  if (steps.length === 0) throw new Error(usage)
  if (spec.total !== false && !steps[steps.length - 1].total) {
    steps.push({ label: typeof spec.total === "string" ? spec.total : "Total", start: 0, end: running, total: true, delta: running })
  }

  const ends = steps.flatMap((s) => [s.start, s.end])
  const lo = Math.min(0, ...ends)
  const hi = Math.max(0, ...ends) === lo ? lo + 1 : Math.max(0, ...ends)
  const values = steps.map((s) => (s.total ? fmtValue(s.end, unitStr) : fmtValue(s.delta, unitStr, { sign: true })))
  const L = layout(ctx, spec, steps.map((s) => s.label), values)
  const scale = L.barW / (hi - lo)
  const zero = -lo * scale
  const totalColor = seriesColor(theme, 0, spec.color)
  const grid = new CellGrid(L.width, steps.length)
  const x0 = L.labelW + 1

  steps.forEach((s, y) => {
    grid.text(0, y, truncate(s.label, L.labelW), s.total ? theme.text : theme.muted, { bold: s.total })
    const a = zero + Math.min(s.start, s.end) * scale
    const b = zero + Math.max(s.start, s.end) * scale
    const color = s.total ? totalColor : s.delta >= 0 ? theme.up : theme.down
    if (b - a > 0) hbar(grid, x0, y, a, Math.max(b, a + 0.125), color)
    // connector: where the previous bar ended
    if (y > 0) {
      const c = x0 + Math.min(L.barW - 1, Math.floor(zero + steps[y - 1].end * scale - 1e-9))
      if (grid.isBlank(c, y)) grid.set(c, y, "┊", theme.grid)
    }
    grid.textRight(L.width, y, values[y], s.total ? theme.text : s.delta >= 0 ? theme.up : theme.down, { bold: s.total })
  })

  const notes = noteRows(spec, L.width, theme)
  return { title: str(spec.title) || undefined, rows: [...notes.top, ...grid.rows(), ...notes.bottom] }
}

export type { Table }
