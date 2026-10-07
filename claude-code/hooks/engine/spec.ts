/**
 * spec.ts — turns the many shapes a model may write into normalized data.
 *
 * Accepted for `data` (and each series' data):
 *   [["2024-01", 4.1], ...]            label/value pairs (null = gap)
 *   [4.1, 4.2, null, 4.0]              bare values (with optional "labels")
 *   {"Laptops": 450, "Monitors": 320}  label → value map
 *   [{"date": "2024-01", "value": 4.1}] objects with common key names
 *   {"CPI": [...], "Core": [...]}      map of series
 * Plus Chart.js style {"labels": [...], "datasets": [{"label", "data"}]}.
 */
import type { Spec } from "./types"

export type Label = string | number
export type Pair = [Label, number | null]
export type RawSeries = { name: string; color?: string; pairs: Pair[] }

const LABEL_KEYS = [
  "x", "label", "name", "date", "time", "t", "period", "category", "key", "month", "year", "day",
  "ts", "timestamp", "group", "bucket", "bin", "quarter", "week",
]
const VALUE_KEYS = [
  "y", "value", "v", "close", "count", "amount", "val", "total", "price", "n", "score", "pct",
  "percent", "rate", "size", "sum", "avg", "mean",
]

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

/** Number, numeric string ("4.1", "1,234", "12%") → number; anything else → null. */
export function num(v: unknown): number | null {
  if (isNum(v)) return v
  if (typeof v === "string") {
    const s = v
      .trim()
      .replace(/^([+-]?)[$€£¥₹]\s?/, "$1") // currency prefix: $1,200, -€5
      .replace(/\s?[$€£¥₹]$/, "") // or suffix: 5 €
      .replace(/,(?=\d{3}\b)/g, "")
      .replace(/%$/, "")
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s)
  }
  return null
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback
}

export function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = num(v)
  if (n === null) return fallback
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

export function optNum(v: unknown): number | undefined {
  const n = num(v)
  return n === null ? undefined : n
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function labelOf(v: unknown, fallback: Label): Label {
  return typeof v === "string" || isNum(v) ? v : fallback
}

function pickLabelKey(o: Record<string, unknown>): string | undefined {
  for (const k of LABEL_KEYS) if (k in o) return k
  return Object.keys(o).find((k) => typeof o[k] === "string")
}

function pickValueKey(o: Record<string, unknown>, labelKey?: string): string | undefined {
  for (const k of VALUE_KEYS) if (k in o && k !== labelKey) return k
  return Object.keys(o).find((k) => k !== labelKey && num(o[k]) !== null)
}

export function toPairs(raw: unknown, labels?: unknown[]): Pair[] {
  if (raw === undefined || raw === null) return []
  if (Array.isArray(raw)) {
    return raw.map((item, i): Pair => {
      const fallback: Label = labels && i < labels.length ? labelOf(labels[i], i + 1) : i + 1
      if (Array.isArray(item)) {
        if (item.length >= 2) return [labelOf(item[0], fallback), num(item[1])]
        return [fallback, num(item[0])]
      }
      if (isPlainObject(item)) {
        const lk = pickLabelKey(item)
        const vk = pickValueKey(item, lk)
        return [lk ? labelOf(item[lk], fallback) : fallback, vk ? num(item[vk]) : null]
      }
      return [fallback, num(item)]
    })
  }
  if (isPlainObject(raw)) return Object.entries(raw).map(([k, v]): Pair => [k, num(v)])
  throw new Error("data: expected an array of [label, value] pairs, an array of numbers or a {label: value} object")
}

function seriesMap(o: Record<string, unknown>, labels?: unknown[]): RawSeries[] {
  return Object.entries(o).map(([name, data]) => ({ name, pairs: toPairs(data, labels) }))
}

const COLUMN_LABEL_KEYS = ["labels", "label", "x", "categories", "category", "dates", "date", "keys", "names", "time", "t"]
const COLUMN_VALUE_KEYS = ["values", "value", "y", "data", "counts", "v"]

/** {"x":[…],"y":[…]} / {"labels":[…],"values":[…]}: parallel columns, not two series. */
function columnar(o: Record<string, unknown>): Pair[] | undefined {
  const lk = COLUMN_LABEL_KEYS.find((k) => Array.isArray(o[k]))
  const vk = COLUMN_VALUE_KEYS.find((k) => k !== lk && Array.isArray(o[k]))
  if (!lk || !vk) return undefined
  return toPairs(o[vk], o[lk] as unknown[])
}

/** Sorts pairs chronologically when every label is a date (models often list newest first). */
export function sortByDate<T>(items: T[], label: (t: T) => unknown): T[] {
  if (items.length < 2) return items
  const keys = items.map((t) => parseDate(label(t)))
  if (keys.some((k) => k === undefined)) return items
  return items.map((t, i) => [t, keys[i]!] as const).sort((a, b) => a[1] - b[1]).map(([t]) => t)
}

/** A {name: [...]} object whose values are all arrays is a map of series. */
function looksLikeSeriesMap(v: unknown): v is Record<string, unknown[]> {
  return isPlainObject(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => Array.isArray(x) || isPlainObject(x))
}

export function readSeries(spec: Spec): RawSeries[] {
  const labels: unknown[] | undefined = Array.isArray(spec.labels)
    ? spec.labels
    : Array.isArray(spec.data?.labels)
      ? spec.data.labels
      : Array.isArray(spec.x)
        ? spec.x
        : undefined

  let out: RawSeries[]
  if (Array.isArray(spec.series)) {
    out = spec.series.map((s: unknown, i: number) => {
      if (Array.isArray(s)) return { name: `series ${i + 1}`, pairs: toPairs(s, labels) }
      const o = isPlainObject(s) ? s : {}
      return {
        name: str(o.name ?? o.label, `series ${i + 1}`),
        color: typeof o.color === "string" ? o.color : undefined,
        pairs: toPairs(o.data ?? o.values ?? o.points ?? o.y, labels),
      }
    })
  } else if (looksLikeSeriesMap(spec.series)) {
    out = seriesMap(spec.series, labels)
  } else if (Array.isArray(spec.datasets) || Array.isArray(spec.data?.datasets)) {
    const ds: unknown[] = spec.datasets ?? spec.data.datasets
    out = ds.map((d, i) => {
      const o = isPlainObject(d) ? d : {}
      const color = [o.color, o.borderColor, o.backgroundColor].find((c) => typeof c === "string" && c.startsWith("#"))
      return { name: str(o.label ?? o.name, `series ${i + 1}`), color: color as string | undefined, pairs: toPairs(o.data, labels) }
    })
  } else if (spec.data !== undefined) {
    const cols = isPlainObject(spec.data) ? columnar(spec.data) : undefined
    if (cols) {
      out = [{ name: str(spec.name), color: typeof spec.color === "string" ? spec.color : undefined, pairs: cols }]
    } else if (looksLikeSeriesMap(spec.data) && !Object.values(spec.data).every((v) => num(v) !== null)) {
      out = seriesMap(spec.data, labels)
    } else {
      out = [{ name: str(spec.name), color: typeof spec.color === "string" ? spec.color : undefined, pairs: toPairs(spec.data, labels) }]
    }
  } else if (Array.isArray(spec.values) || Array.isArray(spec.y)) {
    out = [{ name: str(spec.name), color: typeof spec.color === "string" ? spec.color : undefined, pairs: toPairs(spec.values ?? spec.y, labels) }]
  } else {
    throw new Error('no data: add "data" (or "series")')
  }
  out = out.filter((s) => s.pairs.length > 0)
  if (out.length === 0) throw new Error("data is empty")
  return out
}

/* ------------------------------------------------------------------ */
/* X axis: time / number / category                                    */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000

export function parseDate(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined
  const s = v.trim()
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})[-/](\d{1,2})$/.exec(s))) {
    const mo = +m[2]
    return mo >= 1 && mo <= 12 ? Date.UTC(+m[1], mo - 1, 1) : undefined
  }
  if ((m = /^(\d{4})[- ]?Q([1-4])$/i.exec(s))) return Date.UTC(+m[1], (+m[2] - 1) * 3, 1)
  if ((m = /^Q([1-4])[- ]?(\d{4})$/i.exec(s))) return Date.UTC(+m[2], (+m[1] - 1) * 3, 1)
  if ((m = /^(\d{4})-?W(\d{1,2})$/i.exec(s))) return Date.UTC(+m[1], 0, 1) + (+m[2] - 1) * 7 * DAY
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?(.*)$/.exec(s))) {
    const [, y, mo, d, hh, mi, ss, rest] = m
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return undefined
    if (rest && /^(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(rest)) {
      const t = Date.parse(s)
      if (Number.isFinite(t)) return t
    }
    if (rest && !/^(\.\d+)?$/.test(rest)) return undefined
    return Date.UTC(+y, +mo - 1, +d, +(hh ?? 0), +(mi ?? 0), +(ss ?? 0))
  }
  return undefined
}

export type XKind = "time" | "number" | "category"
export type XYPoint = { x: number; label: string; y: number | null }
export type XYSeries = { name: string; color?: string; points: XYPoint[] }

export function toXY(raw: RawSeries[], opts: { numeric?: boolean } = {}): { series: XYSeries[]; kind: XKind } {
  const labels = raw.flatMap((s) => s.pairs.map((p) => p[0]))
  const allNumeric = labels.every((l) => num(l) !== null)
  const allDates = !allNumeric && labels.every((l) => parseDate(l) !== undefined)
  let kind: XKind = allNumeric ? "number" : allDates ? "time" : "category"
  if (opts.numeric && kind === "category") throw new Error("scatter: x values must be numbers or dates")

  const categories = new Map<string, number>()
  if (kind === "category") for (const l of labels) if (!categories.has(String(l))) categories.set(String(l), categories.size)

  const series = raw.map((s) => {
    const points = s.pairs.map(([l, y]): XYPoint => {
      const label = String(l)
      const x = kind === "number" ? num(l)! : kind === "time" ? parseDate(l)! : categories.get(label)!
      return { x, label, y }
    })
    if (kind !== "category") points.sort((a, b) => a.x - b.x)
    return { name: s.name, color: s.color, points }
  })
  // a single category or number collapses the axis; fine, the renderer centers it
  if (kind === "number" && series.every((s) => s.points.length <= 1)) kind = "category"
  return { series, kind }
}

/* ------------------------------------------------------------------ */
/* Type names                                                          */
/* ------------------------------------------------------------------ */

const ALIASES: Record<string, string> = {
  line: "line", lines: "line", linechart: "line", timeseries: "line", series: "line",
  area: "area", stackedarea: "area",
  drawdown: "drawdown", underwater: "drawdown", dd: "drawdown",
  step: "step", steps: "step", stairs: "step",
  scatter: "scatter", points: "scatter", xy: "scatter", bubble: "scatter",
  bar: "bar", bars: "bar", barh: "bar", hbar: "bar", horizontalbar: "bar", barchart: "bar",
  column: "column", columns: "column", col: "column", vbar: "column", verticalbar: "column",
  heat: "heat", heatmap: "heat", matrix: "heat", table: "heat",
  hist: "hist", histogram: "hist", distribution: "hist",
  candle: "candle", candles: "candle", candlestick: "candle", ohlc: "candle",
  spark: "spark", sparkline: "spark", sparklines: "spark", sparks: "spark", trend: "spark",
  pie: "pie", donut: "pie", doughnut: "pie", ring: "pie",
  gauge: "gauge", gauges: "gauge", meter: "gauge", progress: "gauge", bullet: "gauge",
  stat: "stat", stats: "stat", kpi: "stat", kpis: "stat", tiles: "stat", cards: "stat", scorecard: "stat", metric: "stat", metrics: "stat",
  dumbbell: "dumbbell", dumbell: "dumbbell", barbell: "dumbbell", slope: "dumbbell", beforeafter: "dumbbell", range: "dumbbell",
  box: "box", boxplot: "box", boxes: "box", whisker: "box",
  waterfall: "waterfall", bridge: "waterfall", cascade: "waterfall",
  calendar: "calendar", cal: "calendar", contributions: "calendar", activity: "calendar",
}

export const TYPES = [
  "line", "area", "step", "scatter", "drawdown", "bar", "column", "hist", "heat", "calendar",
  "candle", "pie", "gauge", "stat", "dumbbell", "box", "waterfall", "spark",
]

export function resolveType(spec: Spec): string {
  if (spec.type === undefined || spec.type === null || spec.type === "") return inferType(spec)
  const key = String(spec.type).toLowerCase().replace(/[\s_-]+/g, "")
  const t = ALIASES[key]
  if (!t) throw new Error(`unknown type "${spec.type}" — use one of: ${TYPES.join(", ")}`)
  return t
}

function inferType(spec: Spec): string {
  if (spec.z !== undefined || spec.matrix !== undefined) return "heat"
  if (spec.value !== undefined && spec.data === undefined && spec.series === undefined) return "gauge"
  const d = spec.data
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0]
    if (Array.isArray(first)) {
      if (first.length >= 5) return "candle"
      if (first.length === 2 && isNum(first[0]) && isNum(first[1])) {
        const xs = d.map((p: unknown[]) => p?.[0]).filter(isNum)
        return xs.every((x: number, i: number) => i === 0 || x > xs[i - 1]) ? "line" : "scatter"
      }
      return "line"
    }
    if (isPlainObject(first) && ("open" in first || "o" in first) && ("close" in first || "c" in first)) return "candle"
    return "line"
  }
  if (isPlainObject(d) && Object.values(d).every((v) => num(v) !== null)) return "bar"
  return "line"
}
