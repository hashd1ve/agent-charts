/**
 * chart.ts — pure chart engine for the OpenCode v2 TUI.
 * Zero dependencies: takes a spec (JSON) and returns rows of colored
 * "runs" that get painted onto the terminal grid.
 *
 * Supported types in a ```chart block:
 *   line     {"type":"line","title":"...","data":[["2024-10",4.1],...]}
 *   area     {"type":"area","title":"...","data":[...]}        line with gradient fill
 *   step     {"type":"step","title":"...","data":[...]}        stepped line
 *   line     multi-series: "series":[{"name":"CPI","data":[...]},...]
 *   bar      {"type":"bar","title":"...","data":{"A":450,"B":320}}
 *   heat     {"type":"heat","xLabels":["2021",...],"yLabels":["jan",...],"z":[[v,...],...]}
 *   hist     {"type":"hist","data":[0.3,0.5,...],"bins":8}
 *   candle   {"type":"candle","data":[["2026-01-02",open,high,low,close],...]}
 *   scatter  {"type":"scatter","data":[[1,2.1],[2,3.9],...]}
 *   spark    {"type":"spark","data":[4.1,4.2,4.0]}
 * Options: "width","height","unit" (suffix, e.g. "%"), "yMin","yMax".
 */

export type Run = { text: string; fg?: string }

export type ChartResult = {
  title: string | undefined
  rows: Run[][]
}

/* TokyoNight-style palette */
export const PALETTE = [
  "#7AA2F7", // blue
  "#9ECE6A", // green
  "#FF9E64", // orange
  "#BB9AF7", // violet
  "#2AC3DE", // cyan
  "#E0AF68", // yellow
  "#F7768E", // red
  "#73DACA", // turquoise
]
const MUTED = "#565F89"
const AXIS = "#787C99"
const LIGHT = "#C0CAF5"
const UP = "#9ECE6A"
const DOWN = "#F7768E"

/* ------------------------------------------------------------------ */
/* Color utilities                                                     */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Interpolation between two hex colors, t ∈ [0,1]. */
function lerpHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

/** Cool→warm scale for heatmaps. */
function heatColor(t: number): string {
  if (t < 0.5) return lerpHex("#3B4261", "#7AA2F7", t / 0.5)
  return lerpHex("#7AA2F7", "#FF9E64", (t - 0.5) / 0.5)
}

/* ------------------------------------------------------------------ */
/* Braille canvas: each character = 2 columns × 4 rows of dots         */
/* ------------------------------------------------------------------ */

const BIT_COL0 = [0x01, 0x02, 0x04, 0x40]
const BIT_COL1 = [0x08, 0x10, 0x20, 0x80]

class BrailleCanvas {
  readonly w: number // character cells
  readonly h: number
  readonly bits: Uint8Array
  readonly owner: Int16Array // index of the series owning the cell; -1 = grid; -2 = empty

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.bits = new Uint8Array(w * h)
    this.owner = new Int16Array(w * h).fill(-2)
  }

  setDot(dx: number, dy: number, series: number): void {
    const cell = Math.floor(dx / 2)
    const row = Math.floor(dy / 4)
    if (cell < 0 || cell >= this.w || row < 0 || row >= this.h) return
    const col = dx % 2
    const sub = dy % 4
    const bit = col === 0 ? BIT_COL0[sub] : BIT_COL1[sub]
    const i = row * this.w + cell
    this.bits[i] |= bit
    if (series >= 0) this.owner[i] = series
  }

  /** Full mask on one cell (for solid fills). */
  fillCell(cell: number, row: number, series: number): void {
    if (cell < 0 || cell >= this.w || row < 0 || row >= this.h) return
    const i = row * this.w + cell
    this.bits[i] = 0xff
    this.owner[i] = series
  }

  /** Line between two points on the dot grid (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, series: number): void {
    let x = Math.round(x0)
    let y = Math.round(y0)
    const xe = Math.round(x1)
    const ye = Math.round(y1)
    const dx = Math.abs(xe - x)
    const dy = -Math.abs(ye - y)
    const sx = x < xe ? 1 : -1
    const sy = y < ye ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.setDot(x, y, series)
      if (x === xe && y === ye) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  /** Dotted horizontal line (Y-axis grid). */
  gridRow(dy: number): void {
    for (let dx = 0; dx < this.w * 2; dx += 2) this.setDot(dx, dy, -1)
  }

  render(): { text: string[]; colors: number[][] } {
    const text: string[] = []
    const colors: number[][] = []
    for (let r = 0; r < this.h; r++) {
      let line = ""
      const rowColors: number[] = []
      for (let c = 0; c < this.w; c++) {
        const i = r * this.w + c
        line += String.fromCharCode(0x2800 + this.bits[i])
        rowColors.push(this.owner[i])
      }
      text.push(line)
      colors.push(rowColors)
    }
    return { text, colors }
  }
}

/* ------------------------------------------------------------------ */
/* Number formatting                                                   */
/* ------------------------------------------------------------------ */

export function fmt(v: number, range = 0, unit = ""): string {
  const a = Math.abs(v)
  let out: string
  if (a >= 1e9) out = (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B"
  else if (a >= 1e6) out = (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  else if (a >= 1e4) {
    out = Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  } else {
    const dec = range !== 0 ? (range <= 0.001 ? 4 : range <= 0.01 ? 3 : range <= 0.5 ? 2 : range <= 20 ? 1 : 0) : a >= 100 ? 0 : a >= 10 ? 1 : 2
    out = v.toFixed(dec).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
  }
  return out + unit
}

/* ------------------------------------------------------------------ */
/* Spec normalization                                                  */
/* ------------------------------------------------------------------ */

type Pt = [string | number, number]
type Serie = { name?: string; color?: string; data: Pt[] }

function isNumeric(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v)
}

/** Converts `data` into [label, value] pairs; tolerates nulls (data gaps). */
function toPairs(raw: unknown): Pt[] {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return []
    if (raw.every((p) => Array.isArray(p))) {
      return raw
        .filter((p) => p.length >= 2 && isNumeric(p[1]))
        .map((p) => [p[0] as string | number, p[1] as number] as Pt)
    }
    if (raw.every((v) => v === null || isNumeric(v))) {
      return raw.filter(isNumeric).map((v, i) => [i + 1, v as number] as Pt)
    }
    throw new Error("data: expected [label, value] pairs or numbers")
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => isNumeric(v))
      .map(([k, v]) => [k, v as number] as Pt)
  }
  throw new Error("data: unrecognized format")
}

type Norm = {
  type: string
  title?: string
  width?: number
  height?: number
  unit: string
  series: Serie[]
  extra: Record<string, unknown>
}

function normalize(spec: any): Norm {
  if (spec == null) throw new Error("empty block")
  if (typeof spec === "number" || Array.isArray(spec)) spec = { data: spec }

  const type = String(spec.type ?? inferType(spec))
  let series: Serie[] = []
  if (type === "heat") {
    // the heatmap uses xLabels/yLabels/z; no series
  } else if (type === "hist") {
    const values = (Array.isArray(spec.data) ? spec.data : []).filter(isNumeric)
    series = [{ data: values.map((v, i) => [i, v] as Pt) }]
  } else if (Array.isArray(spec.series) && spec.series.length > 0) {
    series = spec.series.map((s: any, i: number) => ({
      name: s?.name ?? `series ${i + 1}`,
      color: typeof s?.color === "string" ? s.color : undefined,
      data: toPairs(s?.data ?? s),
    }))
  } else {
    series = [{ name: spec.name, color: spec.color, data: toPairs(spec.data) }]
  }
  if (type !== "heat" && (series.length === 0 || series[0].data.length === 0)) throw new Error("no data")

  // Sort by ISO date if all labels look like dates
  if (series[0]?.data.length > 1) {
    const labels = series[0].data.map((p) => String(p[0]))
    if (labels.every((l) => /^\d{4}(-\d{2})?(-\d{2})?$/.test(l))) {
      for (const s of series) s.data = [...s.data].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    }
  }

  return {
    type,
    title: typeof spec.title === "string" ? spec.title : undefined,
    width: isNumeric(spec.width) ? spec.width : undefined,
    height: isNumeric(spec.height) ? spec.height : undefined,
    unit: typeof spec.unit === "string" ? spec.unit : "",
    series,
    extra: spec,
  }
}

function inferType(spec: any): string {
  if (Array.isArray(spec.data) && spec.data.length > 0 && Array.isArray(spec.data[0])) {
    const first = spec.data[0]
    if (first.length >= 5) return "candle"
    if (first.length === 2 && isNumeric(first[0]) && isNumeric(first[1])) return "scatter"
    return "line"
  }
  if (spec.data && typeof spec.data === "object" && !Array.isArray(spec.data)) return "bar"
  if (spec.xLabels && spec.z) return "heat"
  return "line"
}

/* ------------------------------------------------------------------ */
/* Row runs: group consecutive same-color cells                        */
/* ------------------------------------------------------------------ */

type ColorFor = (owner: number) => string | undefined

function makeColorFor(norm: Norm): ColorFor {
  return (owner: number) => {
    if (owner === -1) return MUTED
    if (owner < 0) return undefined
    const s = norm.series[owner % norm.series.length]
    return s?.color ?? PALETTE[owner % PALETTE.length]
  }
}

function mergeRunWithText(colors: number[], chars: string, colorFor: ColorFor): Run[] {
  const runs: Run[] = []
  let buf = ""
  let cur = -2
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i]
    if (c !== cur) {
      if (buf) runs.push({ text: buf, fg: colorFor(cur) })
      buf = ""
      cur = c
    }
    buf += chars[i]
  }
  if (buf) runs.push({ text: buf, fg: colorFor(cur) })
  return runs
}

/* ------------------------------------------------------------------ */
/* Line / area / step / scatter (shared braille canvas)                */
/* ------------------------------------------------------------------ */

const DITHER = [0xff, 0xdb, 0xb6, 0x24] // solid → dense → medium → sparse

function renderLineFamily(norm: Norm, width: number, mode: "line" | "area" | "step" | "scatter"): ChartResult {
  const values = norm.series.flatMap((s) => s.data.map((p) => p[1]))
  const min = (norm.extra as any).yMin ?? Math.min(...values)
  const max = (norm.extra as any).yMax ?? Math.max(...values)
  const lo = min === max ? min - 1 : min
  const hi = min === max ? max + 1 : max
  const range = hi - lo

  const n = norm.series[0].data.length
  const labels = norm.series[0].data.map((p) => String(p[0]))
  const firstLabel = labels[0]
  const lastLabel = labels[n - 1]

  const ticks = [hi, lo + range * 0.5, lo]
  const gutterLabels = ticks.map((t) => fmt(t, range, norm.unit))
  const gutter = Math.max(...gutterLabels.map((l) => l.length)) + 1
  const plotW = Math.max(24, Math.min(100, (norm.width ?? width) - gutter - 2))
  const H = Math.max(4, Math.min(24, norm.height ?? 10))

  const canvas = new BrailleCanvas(plotW, H)
  const yFor = (v: number) => ((hi - v) / range) * (H * 4 - 1)

  // Dotted horizontal grid at each tick
  const tickRows = [0, Math.floor((H - 1) / 2), H - 1]
  for (const r of new Set(tickRows)) canvas.gridRow(Math.round((r / (H - 1)) * (H * 4 - 1)))

  const baselineY = H * 4 - 1

  norm.series.forEach((s, si) => {
    const m = s.data.length
    const xFor = (i: number) => (m === 1 ? (plotW * 2 - 1) / 2 : (i / (m - 1)) * (plotW * 2 - 1))

    if (mode === "scatter") {
      s.data.forEach((p, i) => canvas.setDot(Math.round(xFor(i)), Math.round(yFor(p[1])), si))
      return
    }

    if (mode === "area" && si === 0) {
      // Column-by-column gradient fill: density based on depth
      const maskFor = (depth: number) => DITHER[Math.min(DITHER.length - 1, Math.floor(depth * DITHER.length + 0.0001))]
      for (let i = 0; i < m; i++) {
        const x0 = Math.round(xFor(i))
        const x1 = Math.round(i < m - 1 ? xFor(i + 1) : xFor(i))
        const y0 = yFor(s.data[i][1])
        const y1 = i < m - 1 ? yFor(s.data[i + 1][1]) : y0
        for (let dx = x0; dx <= x1; dx++) {
          const t = x1 === x0 ? 0 : (dx - x0) / (x1 - x0)
          const yTop = Math.round(y0 + (y1 - y0) * t)
          for (let dy = yTop; dy <= baselineY; dy++) {
            const depth = (dy - yTop) / Math.max(1, baselineY - yTop)
            const cell = Math.floor(dx / 2)
            const row = Math.floor(dy / 4)
            if (cell < 0 || cell >= plotW || row < 0 || row >= H) continue
            const col = dx % 2
            const sub = dy % 4
            const bit = col === 0 ? BIT_COL0[sub] : BIT_COL1[sub]
            const idx = row * plotW + cell
            canvas.bits[idx] |= maskFor(depth) & bit
            if (canvas.owner[idx] < 0 || canvas.owner[idx] === si) canvas.owner[idx] = si
          }
        }
      }
    }

    s.data.forEach((p, i) => {
      if (i === 0) {
        if (m === 1 || mode === "step") canvas.setDot(Math.round(xFor(0)), Math.round(yFor(p[1])), si)
        return
      }
      const pv = s.data[i - 1][1]
      const x0 = xFor(i - 1)
      const x1 = xFor(i)
      const y0 = yFor(pv)
      const y1 = yFor(p[1])
      if (mode === "step") {
        const xm = Math.round((x0 + x1) / 2)
        canvas.line(x0, y0, xm, y0, si)
        canvas.line(xm, y0, xm, y1, si)
        canvas.line(xm, y1, x1, y1, si)
      } else {
        canvas.line(x0, y0, x1, y1, si)
      }
    })
  })

  const { text, colors } = canvas.render()
  const colorFor = makeColorFor(norm)
  const rows: Run[][] = []

  for (let r = 0; r < H; r++) {
    const tickIdx = tickRows.indexOf(r)
    const label = tickIdx >= 0 ? gutterLabels[tickIdx] : ""
    const pad = " ".repeat(gutter - label.length)
    const axisCh = tickIdx >= 0 ? "┤" : "│"
    rows.push([{ text: pad + label + axisCh, fg: AXIS }, ...mergeRunWithText(colors[r], text[r], colorFor)])
  }

  rows.push([{ text: " ".repeat(gutter) + "└" + "─".repeat(plotW), fg: AXIS }])
  const xw = Math.max(firstLabel.length, lastLabel.length, 6)
  if (xw * 2 <= plotW) {
    rows.push([{ text: " ".repeat(gutter) + firstLabel.padEnd(plotW - lastLabel.length) + lastLabel, fg: AXIS }])
  }

  if (norm.series.length > 1) {
    const legend: Run[] = []
    norm.series.forEach((s, i) => {
      if (i > 0) legend.push({ text: "  ", fg: AXIS })
      legend.push({ text: "● ", fg: s.color ?? PALETTE[i % PALETTE.length] })
      legend.push({ text: (s.name ?? `series ${i + 1}`) + norm.unit, fg: LIGHT })
    })
    rows.unshift(legend)
  }

  return { title: norm.title, rows }
}

/* ------------------------------------------------------------------ */
/* Bars                                                                */
/* ------------------------------------------------------------------ */

function renderBar(norm: Norm, width: number): ChartResult {
  const entries = norm.series[0].data
  const values = entries.map((p) => p[1])
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const range = hi - lo || 1

  const labelW = Math.min(18, Math.max(...entries.map((p) => String(p[0]).length)))
  const valW = 9 + norm.unit.length
  const barW = Math.max(10, Math.min(80, (norm.width ?? width) - labelW - 1 - valW - 3))
  const zero = ((0 - lo) / range) * (barW - 1)
  const scale = (barW - 1) / range

  const rows: Run[][] = entries.map((p, i) => {
    const label = String(p[0]).slice(0, labelW).padEnd(labelW + 1)
    const v = p[1]
    const cells = new Array<string>(barW).fill(" ")
    const len = Math.max(1, Math.round(Math.abs(v) * scale))
    if (v >= 0) {
      for (let k = 0; k < len && Math.floor(zero) + k < barW; k++) cells[Math.floor(zero) + k] = "▇"
    } else {
      for (let k = 0; k < len && Math.floor(zero) - k >= 0; k++) cells[Math.floor(zero) - k] = "▇"
    }
    const color = norm.series[0].color ?? PALETTE[i % PALETTE.length]
    return [
      { text: label, fg: LIGHT },
      { text: cells.join(""), fg: color },
      { text: " " + fmt(v).padStart(valW - 1), fg: LIGHT },
    ]
  })

  const scaleLine =
    " ".repeat(labelW + 1) +
    fmt(lo, 0, norm.unit).padStart(Math.min(6, Math.floor(barW / 2))) +
    " " +
    "·".repeat(Math.max(0, barW - 8)) +
    " " +
    fmt(hi, 0, norm.unit)
  rows.push([{ text: scaleLine, fg: MUTED }])
  return { title: norm.title, rows }
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

function renderHeat(norm: Norm, width: number): ChartResult {
  const z = (norm.extra as any).z
  const xLabels: string[] = (norm.extra as any).xLabels ?? []
  const yLabels: string[] = (norm.extra as any).yLabels ?? []
  if (!Array.isArray(z) || z.length === 0 || !Array.isArray(z[0])) throw new Error("heat: expected z=[[row],...]")

  const cols = z[0].length
  const flat = z.flat().filter(isNumeric) as number[]
  if (flat.length === 0) throw new Error("heat: no values")
  const lo = Math.min(...flat)
  const hi = Math.max(...flat)
  const range = hi - lo || 1

  const yW = Math.max(4, ...yLabels.map((l) => String(l).length)) + 1
  const cellW = Math.max(5, Math.min(9, Math.floor(((norm.width ?? width) - yW) / cols)))
  const fmtLen = Math.max(...flat.map((v) => fmt(v, range).length))
  const cw = Math.max(cellW, fmtLen + 2)

  const rows: Run[][] = []

  // Header with xLabels
  const header: Run[] = [{ text: " ".repeat(yW), fg: AXIS }]
  for (let c = 0; c < cols; c++) {
    const lab = String(xLabels[c] ?? "").slice(0, cw)
    header.push({ text: lab.padStart(cw), fg: AXIS })
  }
  rows.push(header)

  for (let r = 0; r < z.length; r++) {
    const row: Run[] = [{ text: String(yLabels[r] ?? "").padEnd(yW), fg: LIGHT }]
    for (let c = 0; c < cols; c++) {
      const v = z[r][c]
      if (!isNumeric(v)) {
        row.push({ text: "·".padStart(cw) + " ", fg: MUTED })
        continue
      }
      const t = (v - lo) / range
      row.push({ text: fmt(v, range).padStart(cw) + " ", fg: heatColor(t) })
    }
    rows.push(row)
  }

  // min→max legend
  const legendCells = 8
  const legend: Run[] = [
    { text: " ".repeat(yW), fg: AXIS },
    { text: fmt(lo, range, norm.unit).padEnd(8), fg: LIGHT },
  ]
  for (let i = 0; i < legendCells; i++) {
    legend.push({ text: "██", fg: heatColor(i / (legendCells - 1)) })
  }
  legend.push({ text: " " + fmt(hi, range, norm.unit), fg: LIGHT })
  rows.push(legend)

  return { title: norm.title, rows }
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

function renderHist(norm: Norm, width: number): ChartResult {
  const values = norm.series[0].data.map((p) => p[1])
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (lo === hi) throw new Error("hist: all values are identical")
  const nbins = Math.max(4, Math.min(20, isNumeric((norm.extra as any).bins) ? (norm.extra as any).bins : Math.round(Math.sqrt(values.length) * 1.6)))
  const binW = (hi - lo) / nbins
  const counts = new Array<number>(nbins).fill(0)
  for (const v of values) {
    const idx = Math.min(nbins - 1, Math.floor((v - lo) / binW))
    counts[idx]++
  }
  const dec = binW < 0.01 ? 4 : binW < 0.1 ? 3 : binW < 2 ? 2 : binW < 20 ? 1 : 0
  const entries = counts.map((c, i) => {
    const a = (lo + i * binW).toFixed(dec)
    const b = (lo + (i + 1) * binW).toFixed(dec)
    return [`${a}–${b}`, c] as Pt
  })
  return renderBar(normalize({ type: "bar", title: norm.title, data: entries, color: norm.series[0].color }), width)
}

/* ------------------------------------------------------------------ */
/* OHLC candles                                                        */
/* ------------------------------------------------------------------ */

function renderCandle(norm: Norm, width: number): ChartResult {
  const data = norm.series[0].data
  // original data: [label, open, high, low, close] — rebuild from extra
  const raw = (norm.extra as any).data as unknown[][]
  const ohlc = raw.filter((r) => Array.isArray(r) && r.length >= 5 && isNumeric(r[4]))
  if (ohlc.length === 0) throw new Error("candle: expected [date, open, high, low, close]")

  const highs = ohlc.map((r) => r[2] as number)
  const lows = ohlc.map((r) => r[3] as number)
  const min = Math.min(...lows)
  const max = Math.max(...highs)
  const range = max - min || 1

  const gutterLabels = [max, min].map((t) => fmt(t, range, norm.unit))
  const gutter = Math.max(...gutterLabels.map((l) => l.length)) + 1
  const plotW = Math.max(24, Math.min(110, (norm.width ?? width) - gutter - 2))
  const H = Math.max(6, Math.min(24, norm.height ?? 12))
  const yFor = (v: number) => ((max - v) / range) * (H * 4 - 1)

  const canvas = new BrailleCanvas(plotW, H)
  // owner 0 = bullish, 1 = bearish → custom colors when painting
  const colorFor = (owner: number): string | undefined => (owner === 0 ? UP : owner === 1 ? DOWN : MUTED)

  const n = ohlc.length
  const colsPer = Math.max(1, Math.floor(((plotW * 2 - 1) / Math.max(1, n - 1))))
  const bodyW = Math.max(1, colsPer - 1)

  ohlc.forEach((r, i) => {
    const [, o, h, l, c] = r as [unknown, number, number, number, number]
    const cx = Math.round(n === 1 ? (plotW * 2 - 1) / 2 : (i / (n - 1)) * (plotW * 2 - 1))
    const up = c >= o
    const owner = up ? 0 : 1
    // wick
    canvas.line(cx, yFor(h), cx, yFor(l), owner)
    // body (minimum 1 dot tall)
    const yTop = Math.round(yFor(Math.max(o, c)))
    const yBot = Math.round(yFor(Math.min(o, c)))
    const left = cx - Math.floor(bodyW / 2)
    for (let dx = left; dx < left + bodyW; dx++) {
      for (let dy = yTop; dy <= Math.max(yBot, yTop); dy++) {
        canvas.setDot(dx, dy, owner)
      }
    }
  })

  const { text, colors } = canvas.render()
  const rows: Run[][] = []
  for (let r = 0; r < H; r++) {
    const label = r === 0 ? gutterLabels[0] : r === H - 1 ? gutterLabels[1] : ""
    const pad = " ".repeat(gutter - label.length)
    const axisCh = r === 0 || r === H - 1 ? "┤" : "│"
    rows.push([{ text: pad + label + axisCh, fg: AXIS }, ...mergeRunWithText(colors[r], text[r], colorFor)])
  }
  rows.push([{ text: " ".repeat(gutter) + "└" + "─".repeat(plotW), fg: AXIS }])
  const firstLabel = String(ohlc[0][0])
  const lastLabel = String(ohlc[n - 1][0])
  const xw = Math.max(firstLabel.length, lastLabel.length, 6)
  if (xw * 2 <= plotW) {
    rows.push([{ text: " ".repeat(gutter) + firstLabel.padEnd(plotW - lastLabel.length) + lastLabel, fg: AXIS }])
  }
  const legend: Run[] = [
    { text: "█", fg: UP },
    { text: " bullish   ", fg: LIGHT },
    { text: "█", fg: DOWN },
    { text: " bearish", fg: LIGHT },
  ]
  rows.unshift(legend)
  return { title: norm.title, rows }
}

/* ------------------------------------------------------------------ */
/* Spark                                                               */
/* ------------------------------------------------------------------ */

function renderSpark(norm: Norm): ChartResult {
  const values = norm.series[0].data.map((p) => p[1])
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const range = hi - lo || 1
  const blocks = "▁▂▃▄▅▆▇█"
  const bars = values.map((v) => blocks[Math.round(((v - lo) / range) * 7)]).join("")
  return {
    title: undefined,
    rows: [
      [
        { text: bars, fg: norm.series[0].color ?? PALETTE[0] },
        { text: `  ${fmt(lo, 0, norm.unit)} → ${fmt(hi, 0, norm.unit)}`, fg: MUTED },
      ],
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function buildChart(rawSpec: unknown, opts: { width?: number } = {}): ChartResult {
  const width = Math.max(48, opts.width ?? 76)
  const norm = normalize(rawSpec)
  switch (norm.type) {
    case "bar":
      return renderBar(norm, width)
    case "heat":
      return renderHeat(norm, width)
    case "hist":
      return renderHist(norm, width)
    case "candle":
      return renderCandle(norm, width)
    case "scatter":
      return renderLineFamily(norm, width, "scatter")
    case "area":
      return renderLineFamily(norm, width, "area")
    case "step":
      return renderLineFamily(norm, width, "step")
    case "spark":
      return renderSpark(norm)
    case "line":
    default:
      return renderLineFamily(norm, width, "line")
  }
}

/** Fallback when the block is not JSON: bare numbers → line or spark. */
export function buildFromPlainText(text: string, lang: string, opts: { width?: number } = {}): ChartResult {
  const tokens = text.split(/[\s,]+/).filter((t) => t.length > 0)
  if (tokens.length > 0 && tokens.every((t) => /^-?\d+(\.\d+)?$/.test(t))) {
    const data = tokens.map(Number)
    const type = lang === "spark" ? "spark" : "line"
    return buildChart({ type, data }, opts)
  }
  throw new Error("not JSON or a plain number list")
}
