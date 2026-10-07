/**
 * box.ts — horizontal box plots on a shared axis: whiskers to the last point
 * within 1.5×IQR (Tukey), outliers as dots, median marked inside the box.
 *
 *   {"type":"box","data":{"A":[1,2,3,...],"B":[...]}}
 *   {"type":"box","data":{"A":{"min":1,"q1":2,"median":3,"q3":4,"max":6}}}
 */
import { fmtValue, tickFormatter } from "../format"
import { CellGrid } from "../grid"
import { legend, noteRows, placeXLabels } from "../layout"
import { niceDomain } from "../scale"
import { clampInt, isNum, num, str } from "../spec"
import { strWidth, truncate } from "../text"
import { mix, readableOn, seriesColor } from "../theme"
import type { ChartResult, Ctx, Row, Spec } from "../types"
import { quantile } from "./column"

type Box = { label: string; min: number; q1: number; median: number; q3: number; max: number; outliers: number[]; n?: number }

function summarize(label: string, values: number[]): Box {
  const s = [...values].sort((a, b) => a - b)
  const q1 = quantile(s, 0.25)
  const q3 = quantile(s, 0.75)
  const iqr = q3 - q1
  const loF = q1 - 1.5 * iqr
  const hiF = q3 + 1.5 * iqr
  const inside = s.filter((v) => v >= loF && v <= hiF)
  return {
    label,
    min: inside[0] ?? s[0],
    q1,
    median: quantile(s, 0.5),
    q3,
    max: inside[inside.length - 1] ?? s[s.length - 1],
    outliers: s.filter((v) => v < loF || v > hiF),
    n: s.length,
  }
}

function readBoxes(spec: Spec): Box[] {
  const entries: [string, unknown][] = []
  const d = spec.data
  if (Array.isArray(spec.series)) {
    spec.series.forEach((s: Record<string, unknown>, i: number) => entries.push([str(s?.name ?? s?.label, `#${i + 1}`), s?.data ?? s?.values]))
  } else if (Array.isArray(d) && d.every((v) => num(v) !== null || v === null)) {
    entries.push([str(spec.name ?? spec.label), d])
  } else if (Array.isArray(d)) {
    d.forEach((x: unknown, i: number) => {
      if (Array.isArray(x) && x.length === 2 && Array.isArray(x[1])) entries.push([str(x[0], `#${i + 1}`), x[1]])
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>
        entries.push([str(o.label ?? o.name, `#${i + 1}`), o.values ?? o.data ?? o])
      }
    })
  } else if (d && typeof d === "object") entries.push(...Object.entries(d))
  const boxes: Box[] = []
  for (const [label, v] of entries) {
    if (Array.isArray(v)) {
      const vals = v.map(num).filter(isNum)
      if (vals.length) boxes.push(summarize(label, vals))
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      const q1 = num(o.q1 ?? o.p25)
      const med = num(o.median ?? o.q2 ?? o.p50)
      const q3 = num(o.q3 ?? o.p75)
      if (q1 === null || med === null || q3 === null) continue
      boxes.push({
        label,
        q1,
        median: med,
        q3,
        min: num(o.min ?? o.low) ?? q1,
        max: num(o.max ?? o.high) ?? q3,
        outliers: Array.isArray(o.outliers) ? o.outliers.map(num).filter(isNum) : [],
      })
    }
  }
  if (boxes.length === 0) throw new Error('box: expected "data":{"group":[values...]} or {"group":{"q1","median","q3",...}}')
  return boxes
}

export function renderBox(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const boxes = readBoxes(spec)
  const width = Math.min(ctx.width, clampInt(spec.width, 24, 400, ctx.width), 120)
  const lo = Math.min(...boxes.map((b) => Math.min(b.min, ...b.outliers)))
  const hi = Math.max(...boxes.map((b) => Math.max(b.max, ...b.outliers)))
  const labelW = Math.min(18, Math.max(0, ...boxes.map((b) => strWidth(b.label))))
  const medTexts = boxes.map((b) => fmtValue(b.median, unitStr))
  const medW = Math.max(...medTexts.map(strWidth))
  const plotW = Math.max(10, width - (labelW ? labelW + 1 : 0) - 2 - medW)
  const domain = niceDomain(lo, hi, Math.max(2, Math.floor(plotW / 12)))
  const col = (v: number) => Math.max(0, Math.min(plotW - 1, Math.round(((v - domain.lo) / (domain.hi - domain.lo)) * (plotW - 1))))
  const x0 = labelW ? labelW + 1 : 0

  const grid = new CellGrid(width, boxes.length + 2)
  boxes.forEach((b, y) => {
    const color = seriesColor(theme, boxes.length > 1 && spec.colorful !== false ? y : 0, Array.isArray(spec.colors) ? spec.colors[y] : spec.color)
    const boxBg = mix(theme.background, color, 0.75)
    if (labelW) grid.text(0, y, truncate(b.label, labelW), theme.text)
    const [cMin, cQ1, cMed, cQ3, cMax] = [b.min, b.q1, b.median, b.q3, b.max].map(col)
    for (let c = cMin; c <= cMax; c++) grid.set(x0 + c, y, "─", theme.muted)
    grid.set(x0 + cMin, y, "├", theme.muted)
    grid.set(x0 + cMax, y, "┤", theme.muted)
    for (let c = cQ1; c <= cQ3; c++) grid.set(x0 + c, y, " ", undefined, boxBg)
    grid.set(x0 + cMed, y, "┃", readableOn(boxBg, theme), boxBg, true)
    for (const o of b.outliers) grid.set(x0 + col(o), y, "•", theme.muted)
    grid.textRight(width, y, medTexts[y], theme.text)
  })

  // axis
  const axisY = boxes.length
  for (let c = 0; c < plotW; c++) grid.set(x0 + c, axisY, "─", theme.muted)
  const f = tickFormatter(domain.ticks, domain.step, unitStr)
  for (const l of placeXLabels(domain.ticks.map((t) => ({ col: col(t), label: f(t) })), plotW)) {
    grid.set(x0 + l.col, axisY, "┬", theme.muted)
    grid.text(x0 + l.start, axisY + 1, l.label, theme.muted)
  }

  const notes = noteRows(spec, width, theme)
  const top: Row[] = [...notes.top]
  if (spec.legend === true) top.push(...legend([{ label: "median", color: theme.text, symbol: "┃" }], width, theme))
  return { title: str(spec.title) || undefined, rows: [...top, ...grid.rows(), ...notes.bottom] }
}
