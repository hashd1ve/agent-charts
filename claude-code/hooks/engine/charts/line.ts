/**
 * line.ts — line, area, step and scatter on a braille canvas.
 *
 * All series share one x axis (dates are placed by time, numbers by value,
 * anything else by first appearance), so series with different lengths line
 * up. null values break the line. Options: log, zero, yMin/yMax, refs, trend.
 */
import { BrailleCanvas, LAYER } from "../canvas"
import { fmtPct, fmtValue, tickFormatter } from "../format"
import { CellGrid } from "../grid"
import { type LegendItem, drawXAxis, drawYAxis, flow, gutterWidth, legend, noteRows, placeXLabels, stat, yMarks } from "../layout"
import { type Domain, logDomain, niceDomain, unit } from "../scale"
import { clampInt, num, optNum, readSeries, str, toXY, type XKind, type XYPoint } from "../spec"
import { seriesColor } from "../theme"
import type { ChartResult, Ctx, Row, Run, Spec } from "../types"

export type LineMode = "line" | "area" | "step" | "scatter"

type Ref = { y: number; label?: string; color?: string }

const MAX_WIDTH = 140

/** Accepts "refs"/"hlines"/"hline"/"ref"/"target": a number, {y,label} or a list of either. */
export function readRefs(spec: Spec): Ref[] {
  const raw = spec.refs ?? spec.hlines ?? spec.hline ?? spec.ref ?? spec.target
  if (raw === undefined || raw === null) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out: Ref[] = []
  for (const r of list) {
    if (num(r) !== null) out.push({ y: num(r)! })
    else if (r && typeof r === "object") {
      const y = num(r.y ?? r.value ?? r.at)
      if (y !== null) out.push({ y, label: str(r.label ?? r.name) || undefined, color: typeof r.color === "string" ? r.color : undefined })
    }
  }
  return out
}

function regression(pts: { x: number; y: number }[]): { slope: number; intercept: number; r: number } | undefined {
  const n = pts.length
  if (n < 3) return undefined
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
  for (const p of pts) {
    sx += p.x
    sy += p.y
    sxx += p.x * p.x
    syy += p.y * p.y
    sxy += p.x * p.y
  }
  const vx = n * sxx - sx * sx
  const vy = n * syy - sy * sy
  if (vx === 0) return undefined
  const slope = (n * sxy - sx * sy) / vx
  const r = vy === 0 ? 0 : (n * sxy - sx * sy) / Math.sqrt(vx * vy)
  return { slope, intercept: (sy - slope * sx) / n, r }
}

/** Slope multiplier and suffix: per day/month/year on time axes, per step otherwise. */
function slopeUnit(kind: XKind, span: number): [number, string] {
  if (kind !== "time") return [1, kind === "number" ? "/x" : "/step"]
  const day = 86_400_000
  if (span < 120 * day) return [day, "/day"]
  if (span < 5 * 365 * day) return [30.44 * day, "/mo"]
  return [365.25 * day, "/yr"]
}

/** 4×4 Bayer matrix: ordered dithering for the area gradient. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export function renderLine(spec: Spec, ctx: Ctx, mode: LineMode): ChartResult {
  const { theme } = ctx
  const { series, kind } = toXY(readSeries(spec), { numeric: mode === "scatter" })
  const valued = series.flatMap((s) => s.points.filter((p) => p.y !== null)) as (XYPoint & { y: number })[]
  if (valued.length === 0) throw new Error("no numeric values in data")

  const unitStr = str(spec.unit)
  const colors = series.map((s, i) => seriesColor(theme, i, s.color ?? (series.length === 1 ? spec.color : undefined)))
  const refs = readRefs(spec)
  const H = clampInt(spec.height, 3, 40, mode === "scatter" ? 12 : 10)
  const width = Math.min(ctx.width, clampInt(spec.width, 20, 400, ctx.width), MAX_WIDTH)

  /* ---- y domain ---- */
  const ys = valued.map((p) => p.y).concat(refs.map((r) => r.y))
  const yMin = optNum(spec.yMin ?? spec.ymin ?? spec.min)
  const yMax = optNum(spec.yMax ?? spec.ymax ?? spec.max)
  const wantLog = spec.log === true || spec.yScale === "log" || spec.scale === "log"
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const domain: Domain =
    wantLog && lo > 0
      ? logDomain(lo, hi, { fixedLo: yMin, fixedHi: yMax })
      : niceDomain(lo, hi, Math.max(1, Math.floor(H / 2)), { fixedLo: yMin, fixedHi: yMax, zero: spec.zero === true })

  const marks = yMarks(domain, H, 4, unitStr)
  const gutter = gutterWidth(marks)
  const plotW = Math.max(8, width - gutter - 1)
  const canvas = new BrailleCanvas(plotW, H)
  const yDot = (v: number) => (1 - unit(domain, v)) * (canvas.dotsH - 1)

  /* ---- x domain ---- */
  let xlo = Math.min(...series.flatMap((s) => s.points.map((p) => p.x)))
  let xhi = Math.max(...series.flatMap((s) => s.points.map((p) => p.x)))
  let xTicks: { x: number; label: string }[] | undefined
  if (mode === "scatter" && kind === "number") {
    const xd = niceDomain(xlo, xhi, Math.max(2, Math.floor(plotW / 14)))
    xlo = xd.lo
    xhi = xd.hi
    const f = tickFormatter(xd.ticks, xd.step, str(spec.xUnit))
    xTicks = xd.ticks.map((x) => ({ x, label: f(x) }))
  }
  const xDot = (x: number) => (xhi === xlo ? (canvas.dotsW - 1) / 2 : ((x - xlo) / (xhi - xlo)) * (canvas.dotsW - 1))

  /* ---- background: grid, zero line, references ---- */
  for (const m of marks) canvas.gridRow(Math.round(m.dot), theme.grid)
  if (!domain.log && domain.lo < 0 && domain.hi > 0) {
    const y = Math.round(yDot(0))
    for (let x = 0; x < canvas.dotsW; x++) canvas.dot(x, y, theme.muted, LAYER.grid)
  }
  for (const r of refs) {
    const y = Math.round(yDot(r.y))
    canvas.dashed(0, y, canvas.dotsW - 1, y, r.color ?? theme.warn, LAYER.ref, 3, 2)
  }

  /* ---- series ---- */
  const baseVal = domain.log ? domain.lo : Math.min(Math.max(0, domain.lo), domain.hi)
  const baseY = Math.round(yDot(baseVal))
  const dense = valued.length > 400

  series.forEach((s, si) => {
    const color = colors[si]
    const pts = s.points

    if (mode === "scatter") {
      for (const p of pts) {
        if (p.y === null) continue
        const x = Math.round(xDot(p.x))
        const y = Math.round(yDot(p.y))
        canvas.dot(x, y, color, LAYER.point)
        if (!dense) {
          canvas.dot(x + 1, y, color, LAYER.point)
          canvas.dot(x, y + 1, color, LAYER.point)
          canvas.dot(x + 1, y + 1, color, LAYER.point)
        }
      }
      return
    }

    if (mode === "area") {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        if (a.y === null || b.y === null) continue
        const x0 = Math.round(xDot(a.x))
        const x1 = Math.round(xDot(b.x))
        const y0 = yDot(a.y)
        const y1 = yDot(b.y)
        for (let dx = x0; dx <= x1; dx++) {
          const t = x1 === x0 ? 0 : (dx - x0) / (x1 - x0)
          const yl = Math.round(y0 + (y1 - y0) * t)
          const span = Math.max(1, Math.abs(baseY - yl))
          const dir = baseY >= yl ? 1 : -1
          for (let k = 1; k <= span; k++) {
            const dy = yl + dir * k
            const density = 0.9 - 0.75 * (k / span)
            if ((BAYER[dy & 3][dx & 3] + 0.5) / 16 < density) canvas.dot(dx, dy, color, LAYER.fill)
          }
        }
      }
    }

    let prev: (XYPoint & { y: number }) | undefined
    for (const p of pts) {
      if (p.y === null) {
        prev = undefined
        continue
      }
      const x1 = xDot(p.x)
      const y1 = yDot(p.y)
      if (!prev) canvas.dot(x1, y1, color, LAYER.line)
      else if (mode === "step") {
        const x0 = xDot(prev.x)
        const y0 = yDot(prev.y)
        canvas.line(x0, y0, x1, y0, color, LAYER.line)
        canvas.line(x1, y0, x1, y1, color, LAYER.line)
      } else canvas.line(xDot(prev.x), yDot(prev.y), x1, y1, color, LAYER.line)
      prev = p as XYPoint & { y: number }
    }
  })

  /* ---- trend lines ---- */
  const trends: { name: string; color: string; fit: NonNullable<ReturnType<typeof regression>> }[] = []
  if (spec.trend === true || spec.trendline === true || spec.regression === true) {
    series.forEach((s, si) => {
      const fit = regression(s.points.filter((p) => p.y !== null) as { x: number; y: number }[])
      if (!fit) return
      const color = series.length === 1 ? theme.warn : colors[si]
      const at = (x: number) => fit.intercept + fit.slope * x
      canvas.dashed(xDot(xlo), yDot(at(xlo)), xDot(xhi), yDot(at(xhi)), color, LAYER.ref, 2, 2)
      trends.push({ name: s.name, color, fit })
    })
  }

  /* ---- compose ---- */
  const grid = new CellGrid(width, H + 2)
  drawYAxis(grid, marks, gutter, 0, H, theme)
  canvas.blit(grid, gutter + 1, 0)

  let cands: { col: number; label: string }[]
  if (xTicks) {
    cands = xTicks.map((t) => ({ col: Math.floor(xDot(t.x) / 2), label: t.label }))
  } else {
    const seen = new Map<number, string>()
    for (const s of series) for (const p of s.points) if (!seen.has(p.x)) seen.set(p.x, p.label)
    const all = [...seen.entries()].sort((a, b) => a[0] - b[0])
    cands = all.map(([x, label]) => ({ col: Math.floor(xDot(x) / 2), label }))
  }
  drawXAxis(grid, H, gutter, plotW, placeXLabels(cands, plotW), theme)

  const notes = noteRows(spec, width, theme)
  const top: Row[] = [...notes.top]
  const bottom: Row[] = []

  const legendItems: LegendItem[] = []
  if (series.length > 1 && spec.legend !== false) {
    series.forEach((s, i) => {
      const last = [...s.points].reverse().find((p) => p.y !== null)
      legendItems.push({ label: s.name, color: colors[i], value: last && mode !== "scatter" ? fmtValue(last.y!, unitStr) : undefined })
    })
  }
  for (const r of refs) {
    legendItems.push({ symbol: "┄", label: r.label ?? "ref", color: r.color ?? theme.warn, value: fmtValue(r.y, unitStr) })
  }
  if (legendItems.length) top.push(...legend(legendItems, width, theme))

  if (spec.stats !== false) {
    const items: Run[][] = []
    if (mode === "scatter") {
      if (series.length === 1) {
        items.push(stat("n", String(valued.length), theme))
        const fit = regression(valued)
        if (fit) items.push(stat("r", fit.r.toFixed(2), theme))
      }
    } else if (series.length === 1) {
      const pts = valued
      const first = pts[0].y
      const last = pts[pts.length - 1].y
      const diff = last - first
      const ys1 = pts.map((p) => p.y)
      items.push(stat("last", fmtValue(last, unitStr), theme))
      if (pts.length > 1) {
        let chg = fmtValue(diff, unitStr === "%" ? "" : unitStr, { sign: true })
        if (unitStr !== "%" && first > 0 && last >= 0) chg += ` (${fmtPct((diff / first) * 100)})`
        items.push(stat("chg", chg, theme, diff > 0 ? theme.up : diff < 0 ? theme.down : theme.text))
        items.push(stat("min", fmtValue(Math.min(...ys1), unitStr), theme))
        items.push(stat("max", fmtValue(Math.max(...ys1), unitStr), theme))
      }
    }
    for (const t of trends) {
      const label = series.length > 1 ? `trend ${t.name}` : "trend"
      const [per, suffix] = slopeUnit(kind, xhi - xlo)
      items.push(stat(label, `${fmtValue(t.fit.slope * per, "", { sign: true })}${suffix} · r² ${(t.fit.r * t.fit.r).toFixed(2)}`, theme, t.color))
    }
    bottom.push(...flow(items, width))
  }
  bottom.push(...notes.bottom)

  return { title: str(spec.title) || undefined, rows: [...top, ...grid.rows(), ...bottom] }
}

