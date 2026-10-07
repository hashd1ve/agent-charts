/**
 * stat.ts — KPI tiles: a label, a big value, its change (colored by whether
 * that direction is good) and an optional sparkline, laid out in a grid.
 *
 *   {"type":"stat","data":[{"label":"S&P 500","value":5832,"change":1.2,"spark":[...]}]}
 *   {"type":"stat","data":{"Usuarios":1520,"Errores":19}}
 */
import { fmtPct, fmtValue, withUnit } from "../format"
import { CellGrid } from "../grid"
import { noteRows } from "../layout"
import { clampInt, isNum, num, str } from "../spec"
import { strWidth, truncate } from "../text"
import { seriesColor } from "../theme"
import type { ChartResult, Ctx, Spec, Theme } from "../types"
import { resample, sparkline } from "./spark"

type Tile = {
  label: string
  value: number | string
  unit: string
  change?: number
  delta?: number
  spark?: number[]
  goodUp: boolean
}

function readTiles(spec: Spec): Tile[] {
  const unitAll = str(spec.unit)
  const goodAll = spec.lowerIsBetter !== true && spec.goodDirection !== "down"
  const tile = (label: string, o: Record<string, unknown>): Tile | undefined => {
    const raw = o.value ?? o.v ?? o.y ?? o.last
    const value = num(raw) ?? (typeof raw === "string" && raw ? raw : null)
    if (value === null) return undefined
    const spark = (Array.isArray(o.spark) ? o.spark : Array.isArray(o.history) ? o.history : Array.isArray(o.series) ? o.series : undefined)
      ?.map(num)
      .filter(isNum)
    const prev = num(o.previous ?? o.prev ?? o.from)
    let change = num(o.change ?? o.changePct ?? o.pct)
    if (change === null && typeof value === "number" && prev !== null && prev !== 0) change = ((value - prev) / Math.abs(prev)) * 100
    if (change === null && spark && spark.length > 1 && spark[0] !== 0) change = ((spark[spark.length - 1]! - spark[0]!) / Math.abs(spark[0]!)) * 100
    const lowerBetter = o.lowerIsBetter === true || o.good === "down" || o.goodDirection === "down"
    return {
      label,
      value,
      unit: str(o.unit, unitAll),
      change: change ?? undefined,
      delta: num(o.delta) ?? undefined,
      spark: spark && spark.length > 1 ? spark : undefined,
      goodUp: lowerBetter ? false : o.good === "up" ? true : goodAll,
    }
  }
  const out: Tile[] = []
  const d = spec.data ?? spec.tiles ?? spec.series
  if (spec.value !== undefined && d === undefined) {
    const t = tile(str(spec.label ?? spec.name ?? spec.title), spec)
    if (t) out.push(t)
  } else if (Array.isArray(d)) {
    d.forEach((x: unknown, i: number) => {
      if (x && typeof x === "object" && !Array.isArray(x)) {
        const o = x as Record<string, unknown>
        const t = tile(str(o.label ?? o.name ?? o.title, `#${i + 1}`), o)
        if (t) out.push(t)
      } else if (Array.isArray(x)) {
        const t = tile(str(x[0], `#${i + 1}`), { value: x[1], change: x[2] })
        if (t) out.push(t)
      }
    })
  } else if (d && typeof d === "object") {
    for (const [k, v] of Object.entries(d)) {
      const t = v && typeof v === "object" && !Array.isArray(v) ? tile(k, v as Record<string, unknown>) : tile(k, { value: v })
      if (t) out.push(t)
    }
  }
  if (out.length === 0) throw new Error('stat: expected "data":[{"label":"Revenue","value":120,"change":4.2}, ...]')
  return out
}

/** A headline number keeps the precision it was given (5,832.9 · 1.0842), compacting only millions. */
function fmtKpi(v: number, unit: string): string {
  if (Math.abs(v) >= 1e6) return fmtValue(v, unit)
  const s = String(Number(v.toPrecision(10)))
  const dot = s.indexOf(".")
  const dec = dot < 0 || s.includes("e") ? 0 : Math.min(4, s.length - dot - 1)
  const [int, frac] = v.toFixed(dec).split(".")
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return withUnit(frac ? `${grouped}.${frac}` : grouped, unit)
}

function drawTile(grid: CellGrid, x: number, y: number, w: number, t: Tile, theme: Theme, i: number, spec: Spec): void {
  const inner = w - 4
  const b = theme.grid
  grid.set(x, y, "╭", b)
  grid.set(x + w - 1, y, "╮", b)
  grid.set(x, y + 4, "╰", b)
  grid.set(x + w - 1, y + 4, "╯", b)
  for (let c = 1; c < w - 1; c++) {
    grid.set(x + c, y, "─", b)
    grid.set(x + c, y + 4, "─", b)
  }
  for (let r = 1; r <= 3; r++) {
    grid.set(x, y + r, "│", b)
    grid.set(x + w - 1, y + r, "│", b)
  }
  grid.text(x + 2, y + 1, truncate(t.label, inner), theme.muted)
  const value = typeof t.value === "number" ? fmtKpi(t.value, t.unit) : t.value
  grid.text(x + 2, y + 2, truncate(value, inner), theme.text, { bold: true })

  const dir = t.change ?? t.delta ?? 0
  const good = dir === 0 ? undefined : dir > 0 === t.goodUp
  const color = good === undefined ? theme.muted : good ? theme.up : theme.down
  let used = 0
  if (t.change !== undefined || t.delta !== undefined) {
    const arrow = dir > 0 ? "▲" : dir < 0 ? "▼" : "•"
    const parts = [t.change !== undefined ? fmtPct(t.change) : undefined, t.delta !== undefined ? fmtValue(t.delta, t.unit, { sign: true }) : undefined].filter(Boolean)
    const text = truncate(`${arrow} ${parts.join(" ")}`, inner)
    grid.text(x + 2, y + 3, text, color)
    used = strWidth(text) + 2
  }
  if (t.spark) {
    const room = inner - used
    if (room >= 4) {
      const line = sparkline(resample(t.spark, Math.min(room, t.spark.length)))
      const sparkColor = good === undefined ? seriesColor(theme, i, Array.isArray(spec.colors) ? spec.colors[i] : undefined) : color
      grid.text(x + 2 + inner - strWidth(line), y + 3, line, sparkColor)
    }
  }
}

export function renderStat(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const tiles = readTiles(spec)
  const width = Math.min(ctx.width, clampInt(spec.width, 16, 400, ctx.width), 140)
  const n = tiles.length
  // as many tiles per row as fit at 18+ columns each (or what "columns" asks)
  const minW = Math.min(clampInt(spec.tileWidth, 14, 60, 18), width)
  const perRow = Math.max(1, Math.min(n, clampInt(spec.columns, 1, 12, Math.floor((width + 1) / (minW + 1)) || 1)))
  const tileW = Math.max(12, Math.min(40, Math.floor((width + 1) / perRow) - 1))
  const rowsOfTiles = Math.ceil(n / perRow)
  const grid = new CellGrid(width, rowsOfTiles * 5)
  tiles.forEach((t, i) => drawTile(grid, (i % perRow) * (tileW + 1), Math.floor(i / perRow) * 5, tileW, t, theme, i, spec))
  const notes = noteRows(spec, width, theme)
  return { title: str(spec.title) || undefined, rows: [...notes.top, ...grid.rows(), ...notes.bottom] }
}
