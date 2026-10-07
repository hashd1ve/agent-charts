/**
 * candle.ts — OHLC candlesticks drawn with box-drawing glyphs at half-row
 * resolution (body ┃, wick │, transitions ╽ ╿ ╻ ╹ ╷ ╵). Too many candles for
 * the width get merged into wider periods; an optional 6th value (volume)
 * adds a volume pane.
 */
import { LOWER_EIGHTHS } from "../canvas"
import { fmtPct, fmtValue } from "../format"
import { CellGrid } from "../grid"
import { drawXAxis, drawYAxis, flow, gutterWidth, noteRows, placeXLabels, stat, yMarks } from "../layout"
import { logDomain, niceDomain, unit } from "../scale"
import { clampInt, num, optNum, sortByDate, str } from "../spec"
import { mix } from "../theme"
import type { ChartResult, Ctx, Run, Spec } from "../types"

const MAX_WIDTH = 160

type Candle = { label: string; o: number; h: number; l: number; c: number; v: number | null }

function readCandles(spec: Spec): Candle[] {
  const raw = Array.isArray(spec.data) ? spec.data : []
  const out: Candle[] = []
  raw.forEach((r: unknown, i: number) => {
    let label: unknown
    let o: number | null
    let h: number | null
    let l: number | null
    let c: number | null
    let v: number | null = null
    if (Array.isArray(r)) {
      if (r.length < 5) return
      ;[label, o, h, l, c] = [r[0], num(r[1]), num(r[2]), num(r[3]), num(r[4])]
      v = r.length > 5 ? num(r[5]) : null
    } else if (r && typeof r === "object") {
      const x = r as Record<string, unknown>
      label = x.date ?? x.time ?? x.t ?? x.x ?? x.label
      o = num(x.open ?? x.o)
      h = num(x.high ?? x.h)
      l = num(x.low ?? x.l)
      c = num(x.close ?? x.c)
      v = num(x.volume ?? x.vol ?? x.v)
    } else return
    if (o === null || h === null || l === null || c === null) return
    out.push({ label: label === undefined ? String(i + 1) : String(label), o, h: Math.max(h, o, c, l), l: Math.min(l, o, c, h), c, v })
  })
  if (out.length === 0) throw new Error('candle: expected "data":[["2026-01-02", open, high, low, close, volume?],...]')
  return sortByDate(out, (c) => c.label)
}

/** Merges consecutive candles into groups of k. */
function aggregate(cs: Candle[], k: number): Candle[] {
  if (k <= 1) return cs
  const out: Candle[] = []
  for (let i = 0; i < cs.length; i += k) {
    const g = cs.slice(i, i + k)
    const vols = g.map((x) => x.v).filter((x): x is number => x !== null)
    out.push({
      label: g[0].label,
      o: g[0].o,
      h: Math.max(...g.map((x) => x.h)),
      l: Math.min(...g.map((x) => x.l)),
      c: g[g.length - 1].c,
      v: vols.length ? vols.reduce((a, b) => a + b, 0) : null,
    })
  }
  return out
}

// [top half, bottom half] → glyph. 0 empty, 1 wick, 2 body
const GLYPH: Record<string, string> = {
  "00": " ", "01": "╷", "02": "╻",
  "10": "╵", "11": "│", "12": "╽",
  "20": "╹", "21": "╿", "22": "┃",
}

const FAT_CENTER: Record<string, string> = {
  "00": " ", "01": "╷", "02": "▄",
  "10": "╵", "11": "│", "12": "▄",
  "20": "▀", "21": "▀", "22": "█",
}
const FAT_SIDE: Record<string, string> = {
  "00": " ", "01": " ", "02": "▄",
  "10": " ", "11": " ", "12": "▄",
  "20": "▀", "21": "▀", "22": "█",
}

export function renderCandle(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const width = Math.min(ctx.width, clampInt(spec.width, 24, 400, ctx.width), MAX_WIDTH)
  const H = clampInt(spec.height, 6, 40, 12)
  const all = readCandles(spec)

  const lows = all.map((x) => x.l)
  const highs = all.map((x) => x.h)
  const lo = Math.min(...lows)
  const hi = Math.max(...highs)
  const wantLog = spec.log === true || spec.yScale === "log"
  const domain =
    wantLog && lo > 0
      ? logDomain(lo, hi)
      : niceDomain(lo, hi, Math.max(1, Math.floor(H / 2)), { fixedLo: optNum(spec.yMin), fixedHi: optNum(spec.yMax) })
  const marks = yMarks(domain, H, 2, unitStr)
  const gutter = gutterWidth(marks)
  const plotW = Math.max(8, width - gutter - 1)

  const k = Math.ceil(all.length / plotW)
  const cs = aggregate(all, k)
  const n = cs.length
  const slot = plotW / n
  const colOf = (i: number) => Math.min(plotW - 1, Math.floor(i * slot + slot / 2))
  const halves = H * 2
  const yHalf = (v: number) => Math.max(0, Math.min(halves - 1, Math.floor((1 - unit(domain, v)) * halves - 1e-9)))

  const hasVol = spec.volume !== false && cs.some((x) => x.v !== null && x.v > 0)
  const VH = hasVol ? clampInt(spec.volumeHeight, 2, 8, 3) : 0
  const grid = new CellGrid(width, H + VH + 2)
  drawYAxis(grid, marks, gutter, 0, H, theme)
  for (const m of marks) for (let c = 0; c < plotW; c++) if (c % 2 === 0) grid.set(gutter + 1 + c, m.row, "·", theme.grid)

  // few candles: fat block bodies (3 columns); many: thin box-drawing glyphs
  const fat = slot >= 4
  cs.forEach((x, i) => {
    const col = gutter + 1 + colOf(i)
    const up = x.c >= x.o
    const color = up ? theme.up : theme.down
    const wTop = yHalf(x.h)
    const wBot = yHalf(x.l)
    const bTop = yHalf(Math.max(x.o, x.c))
    const bBot = yHalf(Math.min(x.o, x.c))
    const state = (hf: number) => (hf >= bTop && hf <= bBot ? 2 : hf >= wTop && hf <= wBot ? 1 : 0)
    for (let r = Math.floor(wTop / 2); r <= Math.floor(wBot / 2); r++) {
      const key = `${state(2 * r)}${state(2 * r + 1)}`
      if (!fat) {
        if (GLYPH[key] !== " ") grid.set(col, r, GLYPH[key], color)
        continue
      }
      const c = FAT_CENTER[key]
      if (c !== " ") grid.set(col, r, c, color)
      const side = FAT_SIDE[key]
      if (side !== " ") {
        grid.set(col - 1, r, side, color)
        grid.set(col + 1, r, side, color)
      }
    }
  })

  if (hasVol) {
    const vmax = Math.max(...cs.map((x) => x.v ?? 0)) || 1
    grid.textRight(gutter - 1, H, "vol", theme.muted)
    for (let r = 0; r < VH; r++) grid.set(gutter, H + r, "│", theme.muted)
    cs.forEach((x, i) => {
      if (!x.v) return
      const col = gutter + 1 + colOf(i)
      const color = mix(theme.background, x.c >= x.o ? theme.up : theme.down, 0.55)
      const h = (x.v / vmax) * VH
      const full = Math.floor(h)
      const rest = Math.round((h - full) * 8)
      for (const dx of fat ? [-1, 0, 1] : [0]) {
        for (let r = 0; r < full; r++) grid.set(col + dx, H + VH - 1 - r, "█", color)
        if (rest > 0 && full < VH) grid.set(col + dx, H + VH - 1 - full, LOWER_EIGHTHS[rest], color)
      }
    })
  }

  drawXAxis(
    grid,
    H + VH,
    gutter,
    plotW,
    placeXLabels(cs.map((x, i) => ({ col: colOf(i), label: x.label })), plotW),
    theme,
  )

  const lastC = all[all.length - 1]
  const prev = all.length > 1 ? all[all.length - 2].c : lastC.o
  const chg = lastC.c - prev
  const items: Run[][] = [
    stat("O", fmtValue(lastC.o, unitStr), theme),
    stat("H", fmtValue(lastC.h, unitStr), theme),
    stat("L", fmtValue(lastC.l, unitStr), theme),
    stat("C", fmtValue(lastC.c, unitStr), theme, chg >= 0 ? theme.up : theme.down),
    [{ text: prev !== 0 ? fmtPct((chg / prev) * 100) : fmtValue(chg, unitStr, { sign: true }), fg: chg >= 0 ? theme.up : theme.down }],
  ]
  if (k > 1) items.push([{ text: `1 candle = ${k} periods`, fg: theme.muted }])
  const notes = noteRows(spec, width, theme)
  return {
    title: str(spec.title) || undefined,
    rows: [...notes.top, ...grid.rows(), ...(spec.stats === false ? [] : flow(items, width)), ...notes.bottom],
  }
}
