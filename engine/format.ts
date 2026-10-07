/**
 * format.ts — number formatting for ticks, values and deltas.
 * Currency units ("$", "€", "US$"…) are prefixes, everything else a suffix.
 */

const PREFIX_UNIT = /^([$€£¥₹₩₿¢]|[A-Z]{1,3}\$)$/

export function withUnit(num: string, unit = ""): string {
  if (!unit) return num
  if (PREFIX_UNIT.test(unit)) return /^[+-]/.test(num) ? `${num[0]}${unit}${num.slice(1)}` : unit + num
  return num + unit
}

function groupThousands(s: string): string {
  const [int, dec] = s.split(".")
  const sign = int.startsWith("-") ? "-" : ""
  const digits = sign ? int.slice(1) : int
  const grouped = digits.length > 3 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : digits
  return sign + grouped + (dec !== undefined ? `.${dec}` : "")
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s
}

function noNegZero(s: string): string {
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s
}

const SUFFIXES: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
]

/** Decimals needed to write `step` exactly (0.25 → 2, 2.5 → 1, 50 → 0). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2
  const s = String(Number(step.toPrecision(6)))
  if (s.includes("e-")) return Math.min(10, Number(s.split("e-")[1]))
  const dot = s.indexOf(".")
  return dot < 0 ? 0 : Math.min(10, s.length - dot - 1)
}

/**
 * Formatter for a set of axis ticks: every label shares the same decimals and
 * suffix so the axis reads as a column ("0.5 · 1.0 · 1.5", "25k · 50k").
 */
export function tickFormatter(ticks: number[], step: number, unit = ""): (v: number) => string {
  const maxAbs = Math.max(0, ...ticks.map(Math.abs))
  let div = 1
  let suf = ""
  if (maxAbs >= 1e4) {
    for (const [d, s] of SUFFIXES) {
      if (maxAbs >= d) {
        div = d
        suf = s
        break
      }
    }
  }
  if (maxAbs > 0 && maxAbs < 1e-4) {
    // tiny axes read better in scientific notation: 1e-9, 2e-9, …
    const e = Math.floor(Math.log10(maxAbs))
    const d = Math.min(3, decimalsOf(step / 10 ** e))
    return (v: number) => withUnit(v === 0 ? "0" : `${(v / 10 ** e).toFixed(d)}e${e}`, unit)
  }
  const dec = decimalsOf(step / div)
  // steps tiny next to the values (1e16 ± 2): precision is meaningless
  if (dec > 6) return (v: number) => fmtValue(v, unit, { compact: true })
  return (v: number) => withUnit(noNegZero(groupThousands((v / div).toFixed(dec))) + suf, unit)
}

/**
 * A single value, with sensible precision: 1,234,567 → 1.23M, 12,345 → 12,345,
 * 123.456 → 123.5, 4.1234 → 4.12, 0.012345 → 0.0123.
 */
export function fmtValue(v: number, unit = "", opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "–"
  const a = Math.abs(v)
  let out: string
  if (a >= 1e6 || (opts.compact && a >= 1e4)) {
    const [d, s] = SUFFIXES.find(([d]) => a >= d)!
    const scaled = v / d
    const dec = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2
    out = trimZeros(scaled.toFixed(dec)) + s
  } else if (a >= 1000) {
    out = groupThousands(v.toFixed(0))
  } else if (a >= 100) {
    out = trimZeros(v.toFixed(1))
  } else if (a >= 1) {
    out = trimZeros(v.toFixed(2))
  } else if (a === 0) {
    out = "0"
  } else if (a < 1e-6) {
    out = v.toExponential(2).replace(/\.?0+e/, "e")
  } else {
    const dec = Math.min(8, Math.max(2, -Math.floor(Math.log10(a)) + 2))
    out = trimZeros(v.toFixed(dec))
  }
  out = noNegZero(out)
  if (opts.sign && v > 0) out = `+${out}`
  return withUnit(out, unit)
}

/** Decimals the data itself uses (4.1 → 1, 3.25 → 2), capped. */
export function dataDecimals(values: number[], cap = 2): number {
  let d = 0
  for (const v of values) {
    const s = String(Number(v.toPrecision(10)))
    const i = s.indexOf(".")
    if (i >= 0) d = Math.max(d, s.length - i - 1)
    if (d >= cap) return cap
  }
  return d
}

/** Percent change, signed: +5.1%, −12%. */
export function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return "–"
  const a = Math.abs(p)
  const s = a >= 100 ? p.toFixed(0) : a >= 10 ? p.toFixed(1) : p.toFixed(2)
  return (p > 0 ? "+" : "") + trimZeros(s) + "%"
}
