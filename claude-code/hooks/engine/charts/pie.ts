/**
 * pie.ts — pie and donut charts on a half-block pixel canvas (each cell =
 * two square-ish pixels), with a legend of shares beside or below.
 */
import { PixelCanvas } from "../canvas"
import { fmtValue } from "../format"
import { CellGrid } from "../grid"
import { noteRows } from "../layout"
import { clampInt, num, readSeries, str } from "../spec"
import { padEnd, padStart, strWidth, truncate } from "../text"
import { seriesColor } from "../theme"
import type { ChartResult, Ctx, Row, Run, Spec } from "../types"

const MAX_SLICES = 8

export function renderPie(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const colorsOverride: unknown[] = Array.isArray(spec.colors) ? spec.colors : []
  const series = readSeries(spec)
  let slices = series[0].pairs.map(([l, v]) => ({ label: String(l), value: v ?? 0, color: "" })).filter((s) => s.value > 0)
  if (slices.length === 0) throw new Error("pie: needs positive values")
  if (slices.length > MAX_SLICES) {
    const sorted = [...slices].sort((a, b) => b.value - a.value)
    const keep = sorted.slice(0, MAX_SLICES - 1)
    const rest = sorted.slice(MAX_SLICES - 1).reduce((a, s) => a + s.value, 0)
    slices = [...slices.filter((s) => keep.includes(s)), { label: "Other", value: rest, color: theme.grid }]
  }
  // colors follow the final slice order, so grouping never repeats one
  slices.forEach((s, i) => {
    if (!s.color) s.color = seriesColor(theme, i, colorsOverride[i])
  })
  const total = slices.reduce((a, s) => a + s.value, 0)
  const donut = spec.donut === true || /donut|doughnut|ring/i.test(String(spec.type ?? "")) || num(spec.hole) !== null
  const hole = donut ? Math.max(0.2, Math.min(0.85, num(spec.hole) ?? 0.55)) : 0

  const rows = clampInt(spec.height, 4, 20, 8)
  const width = Math.min(ctx.width, clampInt(spec.width, 20, 400, ctx.width), 120)
  const D = rows * 2
  const canvas = new PixelCanvas(D, rows)
  const R = D / 2
  const bounds: number[] = []
  let acc = 0
  for (const s of slices) {
    acc += s.value / total
    bounds.push(acc)
  }
  for (let py = 0; py < D; py++) {
    for (let px = 0; px < D; px++) {
      const dx = px + 0.5 - R
      const dy = py + 0.5 - R
      const r = Math.hypot(dx, dy)
      if (r > R || r < hole * R) continue
      let a = Math.atan2(dx, -dy) / (2 * Math.PI)
      if (a < 0) a += 1
      const i = bounds.findIndex((b) => a < b)
      canvas.set(px, py, slices[i === -1 ? slices.length - 1 : i].color)
    }
  }

  // legend lines: ● label  share  value
  const shares = slices.map((s) => `${((s.value / total) * 100).toFixed(s.value / total < 0.1 ? 1 : 0)}%`)
  const vals = slices.map((s) => fmtValue(s.value, unitStr))
  const shareW = Math.max(...shares.map(strWidth))
  let valW = Math.max(...vals.map(strWidth))
  let labelW = Math.min(18, Math.max(...slices.map((s) => strWidth(s.label))))
  // a narrow card: shorter labels first, then drop the raw values
  const fixed = () => 2 + 2 + shareW + (valW ? 2 + valW : 0)
  if (fixed() + labelW > width) labelW = Math.max(3, width - fixed())
  if (fixed() + labelW > width) valW = 0
  const legend: Run[][] = slices.map((s, i) => [
    { text: "● ", fg: s.color },
    { text: padEnd(truncate(s.label, labelW), labelW), fg: theme.text },
    { text: `  ${padStart(shares[i], shareW)}`, fg: theme.text },
    ...(valW ? [{ text: `  ${padStart(vals[i], valW)}`, fg: theme.muted }] : []),
  ])
  const legendW = 2 + labelW + 2 + shareW + (valW ? 2 + valW : 0)
  const side = D + 3 + legendW <= width

  const notes = noteRows(spec, width, theme)
  const out: Row[] = [...notes.top]
  const grid = new CellGrid(side ? Math.min(width, D + 3 + legendW) : Math.min(width, D), rows)
  canvas.blit(grid, 0, 0)
  if (donut && hole * D >= 6) {
    const label = fmtValue(total, unitStr, { compact: true })
    if (strWidth(label) <= Math.floor(hole * D) - 2) grid.text(Math.round(R - strWidth(label) / 2), Math.floor(rows / 2) - (rows % 2 === 0 ? 1 : 0), label, theme.text, { bold: true })
  }
  const gridRows = grid.rows()
  if (side) {
    const offset = Math.max(0, Math.floor((rows - legend.length) / 2))
    gridRows.forEach((row, r) => {
      const li = r - offset
      const pad = D + 3 - row.reduce((w, run) => w + strWidth(run.text), 0)
      out.push(li >= 0 && li < legend.length ? [...row, { text: " ".repeat(Math.max(0, pad)) }, ...legend[li]] : row)
    })
    for (let li = rows - offset; li < legend.length; li++) out.push([{ text: " ".repeat(D + 3) }, ...legend[li]])
  } else {
    out.push(...gridRows, ...legend)
  }
  if (spec.total !== false && !donut) out.push([{ text: "total ", fg: theme.muted }, { text: fmtValue(total, unitStr), fg: theme.text }])
  out.push(...notes.bottom)
  return { title: str(spec.title) || undefined, rows: out }
}
