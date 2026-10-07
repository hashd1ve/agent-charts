/**
 * index.ts — engine entry: spec (or block text) → ChartResult.
 */
import { renderBar, renderWaterfall } from "./charts/bar"
import { renderBox } from "./charts/box"
import { renderCandle } from "./charts/candle"
import { renderColumn, renderHist } from "./charts/column"
import { renderGauge } from "./charts/gauge"
import { renderCalendar, renderHeat } from "./charts/heat"
import { renderLine } from "./charts/line"
import { renderPie } from "./charts/pie"
import { renderSpark } from "./charts/spark"
import { clipRow } from "./grid"
import { parseRelaxedJSON } from "./json"
import { num, parseDate, resolveType } from "./spec"
import { isHex, resolveTheme } from "./theme"
import type { BuildOptions, ChartResult, Ctx, Spec } from "./types"

export function buildChart(rawSpec: unknown, opts: BuildOptions = {}): ChartResult {
  let spec: Spec
  if (rawSpec === null || rawSpec === undefined) throw new Error("empty chart block")
  if (Array.isArray(rawSpec) || typeof rawSpec === "number") spec = { data: rawSpec }
  else if (typeof rawSpec === "object") spec = rawSpec as Spec
  else throw new Error("chart spec must be a JSON object")

  // Chart.js-style {type, data: {labels, datasets}, options: {plugins: {title}}}
  if (spec.options?.plugins?.title?.text && !spec.title) spec = { ...spec, title: String(spec.options.plugins.title.text) }

  let theme = resolveTheme(opts.theme)
  if (Array.isArray(spec.colors) && spec.colors.some(isHex)) {
    const base = theme.palette
    theme = { ...theme, palette: spec.colors.map((c: unknown, i: number) => (isHex(c) ? c : base[i % base.length])) }
  }
  const ctx: Ctx = { width: Math.max(20, Math.floor(opts.width ?? 80)), theme }
  const res = render(resolveType(spec), spec, ctx)
  return { ...res, rows: res.rows.map((r) => clipRow(r, ctx.width)) }
}

function render(type: string, spec: Spec, ctx: Ctx): ChartResult {
  switch (type) {
    case "line":
    case "area":
    case "step":
    case "scatter":
      return renderLine(spec, ctx, type)
    case "bar":
      return renderBar(spec, ctx)
    case "column":
      return renderColumn(spec, ctx)
    case "hist":
      return renderHist(spec, ctx)
    case "heat":
      return renderHeat(spec, ctx)
    case "calendar":
      return renderCalendar(spec, ctx)
    case "candle":
      return renderCandle(spec, ctx)
    case "pie":
      return renderPie(spec, ctx)
    case "gauge":
      return renderGauge(spec, ctx)
    case "box":
      return renderBox(spec, ctx)
    case "waterfall":
      return renderWaterfall(spec, ctx)
    case "spark":
      return renderSpark(spec, ctx)
  }
  throw new Error(`unsupported type "${type}"`)
}

const GROUPED = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/

/** Splits one CSV-ish line, honouring double quotes ("1,234" stays one cell). */
function splitCells(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (c === sep && !quoted) {
      out.push(cur.trim())
      cur = ""
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

/**
 * Non-JSON block bodies:
 *   4.1 4.2 4.0  /  1,234 2,345   bare numbers → line (or spark for ```spark)
 *   Revenue: 1,200                label/value lines → bar (line if labels are dates)
 *   month,cpi,core                CSV/TSV with a header → one series per column
 */
export function specFromText(text: string, lang = "chart"): Spec {
  const body = text.trim()
  const type = (dates: boolean) => (lang === "spark" ? "spark" : dates ? "line" : "bar")

  // bare numbers: whitespace-separated (thousands separators allowed), else comma-separated
  const words = body.split(/[\s;]+/).map((w) => w.replace(/,$/, "")).filter(Boolean)
  if (words.length > 1 && words.every((w) => num(w) !== null && (!w.includes(",") || GROUPED.test(w)))) {
    return { type: lang === "spark" ? "spark" : "line", data: words.map((w) => num(w)) }
  }
  const tokens = body.split(/[\s,;]+/).filter(Boolean)
  if (tokens.length > 0 && tokens.every((t) => num(t) !== null)) {
    return { type: lang === "spark" ? "spark" : "line", data: tokens.map((t) => num(t)) }
  }

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  let best: { cells: string[][]; header?: string[]; score: number } | undefined
  // ";" before ",": semicolon files use the comma as decimal mark (a;1,5)
  for (const sep of ["\t", ";", ":", ",", "|"]) {
    if (!lines.every((l) => l.includes(sep))) continue
    const decimalComma = (c: string) => (sep === ";" ? c.replace(/^([+-]?\d+),(\d+)$/, "$1.$2") : c)
    const cells = lines.map((l) =>
      splitCells(l, sep)
        .map(decimalComma)
        .filter((c, i, a) => c !== "" || (i > 0 && i < a.length - 1)),
    )
    if (cells.some((r) => r.length < 2)) continue
    const header = cells[0].slice(1).some((c) => num(c) === null) ? cells[0] : undefined
    const rows = header ? cells.slice(1) : cells
    if (rows.length === 0) continue
    const values = rows.flatMap((r) => r.slice(1))
    const score = values.filter((c) => num(c) !== null).length / Math.max(1, values.length)
    if (!best || score > best.score) best = { cells: rows, header, score }
  }
  if (best && best.score >= 0.5) {
    const { cells, header } = best
    const cols = Math.max(...cells.map((r) => r.length))
    const labels = cells.map((r) => r[0])
    const dates = labels.every((l) => parseDate(l) !== undefined || /^\d{4}$/.test(l))
    const series = Array.from({ length: cols - 1 }, (_, j) => ({
      name: header?.[j + 1] ?? `series ${j + 1}`,
      data: cells.map((r) => [r[0], num(r[j + 1])]),
    }))
    return series.length === 1 ? { type: type(dates), data: series[0].data, name: header?.[1] } : { type: type(dates), series }
  }
  throw new Error('not a chart spec: write JSON like {"type":"line","data":[["2024-01",4.1],...]}')
}

/** Parses the raw body of a ```chart / ```spark block. */
export function parseBlock(text: string, lang = "chart"): Spec {
  const raw = text.trim()
  if (!raw) throw new Error("empty chart block")
  if (raw.startsWith("{") || raw.startsWith("[")) {
    const v = parseRelaxedJSON(raw)
    const spec: Spec = Array.isArray(v) ? { data: v } : (v as Spec)
    if (lang === "spark" && spec && typeof spec === "object" && spec.type === undefined) spec.type = "spark"
    return spec
  }
  return specFromText(raw, lang)
}

export function buildFromText(text: string, lang = "chart", opts: BuildOptions = {}): ChartResult {
  return buildChart(parseBlock(text, lang), opts)
}

export { DARK, LIGHT, resolveTheme } from "./theme"
export { TYPES } from "./spec"
export type { BuildOptions, ChartResult, Row, Run, Theme } from "./types"
