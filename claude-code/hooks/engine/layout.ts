/**
 * layout.ts — pieces shared by the charts: y-axis gutter, x-axis labels,
 * legends and flowing info rows.
 */
import { tickFormatter, fmtValue } from "./format"
import type { CellGrid } from "./grid"
import { type Domain, unit } from "./scale"
import { strWidth, truncate } from "./text"
import type { Row, Run, Theme } from "./types"

/* ------------------------------------------------------------------ */
/* Y axis                                                              */
/* ------------------------------------------------------------------ */

export type YMark = { row: number; label: string; value: number; dot: number }

/**
 * Places the domain's ticks on a plot of `rows` rows whose rows are split in
 * `sub` sub-rows (4 for braille, 8 for eighth blocks). One label per row.
 */
export function yMarks(domain: Domain, rows: number, sub: number, unitStr: string): YMark[] {
  const fmt = domain.log ? (v: number) => fmtValue(v, unitStr, { compact: true }) : tickFormatter(domain.ticks, domain.step, unitStr)
  const marks: YMark[] = []
  const used = new Set<number>()
  for (const t of [...domain.ticks].sort((a, b) => b - a)) {
    const u = unit(domain, t)
    if (u < -1e-9 || u > 1 + 1e-9) continue
    const dot = Math.round((1 - u) * (rows * sub - 1))
    const row = Math.min(rows - 1, Math.max(0, Math.floor(dot / sub)))
    if (used.has(row)) continue
    used.add(row)
    marks.push({ row, label: fmt(t), value: t, dot })
  }
  // crowded axis (labels on adjacent rows): keep every other one, and
  // re-format for the doubled step (2.5 · 3.0 · 3.5 rather than 2.50 · 3.00)
  if (rows >= 6 && marks.some((m, i) => i > 0 && m.row - marks[i - 1].row === 1)) {
    const kept = marks.filter((_, i) => i % 2 === 0)
    if (domain.log) return kept
    const f2 = tickFormatter(kept.map((m) => m.value), domain.step * 2, unitStr)
    const relabeled = kept.map((m) => ({ ...m, label: f2(m.value) }))
    // keep the finer labels if the coarser ones would collapse distinct ticks
    return new Set(relabeled.map((m) => m.label)).size === relabeled.length ? relabeled : kept
  }
  return marks
}

export function gutterWidth(marks: YMark[]): number {
  return Math.max(1, ...marks.map((m) => strWidth(m.label))) + 1
}

/** Labels right-aligned in [0, gutter), axis line in column `gutter`. */
export function drawYAxis(grid: CellGrid, marks: YMark[], gutter: number, top: number, rows: number, theme: Theme): void {
  const byRow = new Map(marks.map((m) => [m.row, m]))
  for (let r = 0; r < rows; r++) {
    const m = byRow.get(r)
    if (m) grid.textRight(gutter - 1, top + r, m.label, theme.muted)
    grid.set(gutter, top + r, m ? "┤" : "│", theme.muted)
  }
}

/* ------------------------------------------------------------------ */
/* X axis                                                              */
/* ------------------------------------------------------------------ */

export type XCand = { col: number; label: string }

/**
 * Picks non-overlapping labels: first and last always win, then a regular
 * stride through the rest so the spacing stays even.
 */
export function placeXLabels(cands: XCand[], width: number, maxLabel = 12): { col: number; start: number; label: string }[] {
  if (cands.length === 0 || width <= 0) return []
  const labels = cands.map((c) => ({ col: c.col, label: truncate(c.label, Math.min(maxLabel, width)) }))
  // thin dense candidates to a regular stride before the greedy pass
  const widest = Math.max(...labels.map((l) => strWidth(l.label)))
  const room = Math.max(2, Math.floor((width + 3) / (widest + 3)))
  let order: number[]
  if (labels.length > room) {
    const stride = Math.ceil((labels.length - 1) / (room - 1))
    order = [0, labels.length - 1]
    for (let i = stride; i < labels.length - 1; i += stride) order.push(i)
  } else {
    order = labels.map((_, i) => i)
    if (order.length > 1) order.splice(1, 0, order.pop()!)
  }
  const placed: { col: number; start: number; label: string; end: number }[] = []
  for (const i of order) {
    const { col, label } = labels[i]
    const w = strWidth(label)
    const start = Math.max(0, Math.min(width - w, Math.round(col - (w - 1) / 2)))
    const end = start + w
    if (placed.some((p) => start < p.end + 1 && end + 1 > p.start)) continue
    placed.push({ col, start, label, end })
  }
  return placed.sort((a, b) => a.start - b.start)
}

/** "└──┬────┬──" axis line at `row` and its labels one row below. */
export function drawXAxis(
  grid: CellGrid,
  row: number,
  gutter: number,
  plotW: number,
  labels: { col: number; start: number; label: string }[],
  theme: Theme,
  opts: { corner?: string } = {},
): void {
  grid.set(gutter, row, opts.corner ?? "└", theme.muted)
  for (let c = 0; c < plotW; c++) grid.set(gutter + 1 + c, row, "─", theme.muted)
  for (const l of labels) {
    if (l.col >= 0 && l.col < plotW) grid.set(gutter + 1 + l.col, row, "┬", theme.muted)
    grid.text(gutter + 1 + l.start, row + 1, l.label, theme.muted)
  }
}

/* ------------------------------------------------------------------ */
/* Flowing rows: legends, stats, notes                                 */
/* ------------------------------------------------------------------ */

function itemWidth(item: Run[]): number {
  return item.reduce((w, r) => w + strWidth(r.text), 0)
}

function truncateItem(item: Run[], max: number): Run[] {
  const out: Run[] = []
  let left = max
  for (const r of item) {
    if (left <= 0) break
    const w = strWidth(r.text)
    if (w <= left) {
      out.push(r)
      left -= w
    } else {
      out.push({ ...r, text: truncate(r.text, left) })
      left = 0
    }
  }
  return out
}

/** Lays atomic items out left to right, wrapping at `width`. */
export function flow(items: Run[][], width: number, sep = "  "): Row[] {
  const rows: Row[] = []
  let cur: Run[] = []
  let w = 0
  for (const raw of items) {
    const item = itemWidth(raw) > width ? truncateItem(raw, width) : raw
    const iw = itemWidth(item)
    if (cur.length > 0 && w + sep.length + iw > width) {
      rows.push(cur)
      cur = []
      w = 0
    }
    if (cur.length > 0) {
      cur.push({ text: sep })
      w += sep.length
    }
    cur.push(...item)
    w += iw
  }
  if (cur.length) rows.push(cur)
  return rows
}

export type LegendItem = { label: string; color: string; symbol?: string; value?: string }

export function legend(items: LegendItem[], width: number, theme: Theme): Row[] {
  return flow(
    items.map((it) => {
      const runs: Run[] = [
        { text: `${it.symbol ?? "●"} `, fg: it.color },
        { text: it.label, fg: theme.text },
      ]
      if (it.value) runs.push({ text: ` ${it.value}`, fg: theme.muted })
      return runs
    }),
    width,
  )
}

/** "label value" pairs for stats rows: muted label, bright value. */
export function stat(label: string, value: string, theme: Theme, valueColor?: string): Run[] {
  return label ? [{ text: `${label} `, fg: theme.muted }, { text: value, fg: valueColor ?? theme.text }] : [{ text: value, fg: valueColor ?? theme.text }]
}

export function noteRows(spec: { subtitle?: unknown; note?: unknown; source?: unknown }, width: number, theme: Theme): { top: Row[]; bottom: Row[] } {
  const top: Row[] = []
  const bottom: Row[] = []
  if (typeof spec.subtitle === "string" && spec.subtitle) top.push([{ text: truncate(spec.subtitle, width), fg: theme.muted }])
  const note = [spec.note, spec.source ? `source: ${spec.source}` : undefined].filter((v) => typeof v === "string" && v)
  for (const n of note) bottom.push([{ text: truncate(n as string, width), fg: theme.muted }])
  return { top, bottom }
}
