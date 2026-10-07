/**
 * gauge.ts — meters / progress bars / bullet charts.
 *
 *   {"type":"gauge","value":72,"max":100,"label":"CPU"}
 *   {"type":"gauge","data":{"CPU":72,"RAM":45},"max":100,"unit":"%","thresholds":[60,85]}
 *   {"type":"gauge","data":[{"label":"Q3 revenue","value":8.1,"max":10,"target":9}]}
 */
import { hbar } from "../canvas"
import { fmtValue } from "../format"
import { CellGrid } from "../grid"
import { noteRows } from "../layout"
import { clampInt, num, str } from "../spec"
import { strWidth, truncate } from "../text"
import { mix, seriesColor } from "../theme"
import type { ChartResult, Ctx, Spec } from "../types"

type Meter = { label: string; value: number; min: number; max: number; target?: number }

function readMeters(spec: Spec): Meter[] {
  const gMin = num(spec.min) ?? 0
  const gMax = num(spec.max)
  const gTarget = num(spec.target) ?? undefined
  const raw: { label: string; value: number | null; max?: number | null; min?: number | null; target?: number | null }[] = []
  if (spec.value !== undefined) raw.push({ label: str(spec.label ?? spec.name), value: num(spec.value) })
  const d = spec.data ?? spec.series
  if (Array.isArray(d)) {
    d.forEach((x: unknown, i: number) => {
      if (Array.isArray(x)) raw.push({ label: str(x[0], `#${i + 1}`), value: num(x[1]), max: num(x[2]) })
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>
        raw.push({ label: str(o.label ?? o.name, `#${i + 1}`), value: num(o.value ?? o.v ?? o.y), max: num(o.max), min: num(o.min), target: num(o.target) })
      } else raw.push({ label: `#${i + 1}`, value: num(x) })
    })
  } else if (d && typeof d === "object") {
    for (const [k, v] of Object.entries(d)) raw.push({ label: k, value: num(v) })
  }
  const valid = raw.filter((r) => r.value !== null) as (typeof raw[number] & { value: number })[]
  if (valid.length === 0) throw new Error('gauge: expected "value" or "data":{"label": value}')
  const allPct = valid.every((r) => r.value >= 0 && r.value <= 100) && str(spec.unit) === "%"
  const auto = gMax ?? (allPct ? 100 : valid.every((r) => r.value >= 0 && r.value <= 1) ? 1 : valid.every((r) => r.value <= 100) ? 100 : Math.max(...valid.map((r) => r.value)))
  return valid.map((r) => ({
    label: r.label,
    value: r.value,
    min: r.min ?? gMin,
    max: r.max ?? auto,
    target: r.target ?? gTarget,
  }))
}

export function renderGauge(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const meters = readMeters(spec)
  const width = Math.min(ctx.width, clampInt(spec.width, 20, 400, ctx.width), 100)
  const thresholds = Array.isArray(spec.thresholds) ? spec.thresholds.map(num).filter((v: number | null): v is number => v !== null) : []
  const invert = spec.invert === true || spec.higherIsBetter === true

  let labelW = Math.min(20, Math.max(0, ...meters.map((m) => strWidth(m.label))))
  const pctOf = (m: Meter) => (m.max > m.min ? ((m.value - m.min) / (m.max - m.min)) * 100 : 0)
  const plainPct = (m: Meter) => unitStr === "%" && m.max === 100 && m.min === 0
  let texts = meters.map((m) => (plainPct(m) ? fmtValue(m.value, unitStr) : `${fmtValue(m.value, unitStr)} / ${fmtValue(m.max, unitStr)}  ${Math.round(pctOf(m))}%`))
  const MIN_BAR = 6
  const room = () => width - (labelW ? labelW + 1 : 0) - 1 - Math.max(...texts.map(strWidth))
  // narrow: drop "value / max", keep the percentage; then shrink the labels
  if (room() < MIN_BAR) texts = meters.map((m) => (plainPct(m) ? fmtValue(m.value, unitStr) : `${Math.round(pctOf(m))}%`))
  if (room() < MIN_BAR && labelW) labelW = Math.max(3, labelW - (MIN_BAR - room()))
  const textW = Math.max(...texts.map(strWidth))
  const barW = Math.max(1, width - (labelW ? labelW + 1 : 0) - 1 - textW)
  const track = mix(theme.background, theme.muted, 0.28)
  const grid = new CellGrid(width, meters.length)

  meters.forEach((m, y) => {
    let x0 = 0
    if (labelW) {
      grid.text(0, y, truncate(m.label, labelW), theme.text)
      x0 = labelW + 1
    }
    let color = seriesColor(theme, 0, spec.color)
    if (thresholds.length) {
      const level = thresholds.filter((t: number) => m.value >= t).length
      const scale = invert ? [theme.down, theme.warn, theme.up] : [theme.up, theme.warn, theme.down]
      color = scale[Math.min(scale.length - 1, Math.round((level / thresholds.length) * (scale.length - 1)))]
    }
    for (let c = 0; c < barW; c++) grid.set(x0 + c, y, " ", undefined, track)
    const frac = Math.max(0, Math.min(1, (m.value - m.min) / (m.max - m.min || 1)))
    if (frac > 0) hbar(grid, x0, y, 0, Math.max(0.125, frac * barW), color)
    for (let c = 0; c < barW; c++) {
      const cell = grid.get(x0 + c, y)
      if (cell && !cell.bg) cell.bg = cell.ch === "█" ? undefined : track
    }
    if (m.target !== undefined) {
      const tc = Math.min(barW - 1, Math.max(0, Math.round(((m.target - m.min) / (m.max - m.min || 1)) * barW - 0.5)))
      const under = grid.get(x0 + tc, y)
      grid.set(x0 + tc, y, "┃", theme.text, under?.ch === "█" ? under.fg : track)
    }
    grid.textRight(width, y, texts[y], theme.text)
  })

  const notes = noteRows(spec, width, theme)
  return { title: str(spec.title) || undefined, rows: [...notes.top, ...grid.rows(), ...notes.bottom] }
}
