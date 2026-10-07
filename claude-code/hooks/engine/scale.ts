/**
 * scale.ts — "nice" axis domains and ticks (1-2-2.5-5 × 10ⁿ), linear and log.
 */

export type Domain = {
  lo: number
  hi: number
  ticks: number[]
  step: number
  log: boolean
}

function clean(v: number): number {
  return Number(v.toPrecision(12))
}

export function niceStep(span: number, intervals: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const raw = span / Math.max(1, intervals)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return nice * mag
}

/**
 * Domain covering [min, max] with round ends and ~`intervals` ticks.
 * `fixedLo`/`fixedHi` pin an end (the model asked for yMin/yMax).
 */
export function niceDomain(
  min: number,
  max: number,
  intervals: number,
  opts: { fixedLo?: number; fixedHi?: number; zero?: boolean; integer?: boolean } = {},
): Domain {
  let lo = opts.fixedLo ?? min
  let hi = opts.fixedHi ?? max
  if (opts.zero) {
    if (opts.fixedLo === undefined) lo = Math.min(lo, 0)
    if (opts.fixedHi === undefined) hi = Math.max(hi, 0)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0
    hi = 1
  }
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1
    if (opts.fixedLo === undefined) lo -= pad
    if (opts.fixedHi === undefined) hi += pad
    if (lo === hi) hi = lo + 1
  }
  const span = hi - lo
  // overflowing spans or steps below float precision at this magnitude
  // (1e16 + 2): no nice ticks exist, keep the raw ends
  let step = niceStep(span, intervals)
  if (opts.integer) step = Math.max(1, Math.round(step))
  if (!Number.isFinite(span) || lo + step === lo || hi + step === hi) {
    return { lo, hi, ticks: [lo, hi], step: Number.isFinite(span) ? span : 0, log: false }
  }
  const nlo = opts.fixedLo ?? clean(Math.floor(lo / step + 1e-9) * step)
  const nhi = opts.fixedHi ?? clean(Math.ceil(hi / step - 1e-9) * step)
  const first = Math.ceil(nlo / step - 1e-9)
  const count = Math.floor(nhi / step + 1e-9) - first
  const ticks: number[] = []
  if (Number.isFinite(count) && count >= 0 && count <= 1000) {
    for (let i = 0; i <= count; i++) ticks.push(clean((first + i) * step))
  }
  if (ticks.length === 0) ticks.push(nlo, nhi)
  return { lo: nlo, hi: nhi === nlo ? nlo + step : nhi, ticks: [...new Set(ticks)], step, log: false }
}

/** Log₁₀ domain for strictly positive data (prices over many years, growth). */
export function logDomain(min: number, max: number, opts: { fixedLo?: number; fixedHi?: number } = {}): Domain {
  const pad = (max / min) ** 0.04
  const lo = opts.fixedLo && opts.fixedLo > 0 ? opts.fixedLo : min / pad
  const hi = opts.fixedHi && opts.fixedHi > 0 ? opts.fixedHi : max === min ? max * 10 : max * pad
  const decades = Math.log10(hi) - Math.log10(lo)
  const mult = decades <= 0.6 ? [1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9] : decades <= 1.2 ? [1, 2, 5] : decades <= 3 ? [1, 3] : [1]
  const ticks: number[] = []
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of mult) {
      const t = clean(m * 10 ** e)
      if (t >= lo && t <= hi) ticks.push(t)
    }
  }
  if (ticks.length < 2) return { ...niceDomain(lo, hi, 3), lo, hi, log: true }
  return { lo, hi, ticks, step: 0, log: true }
}

/** Maps a value to [0,1] within the domain (0 = lo). */
export function unit(d: Domain, v: number): number {
  if (d.log) return (Math.log10(Math.max(v, 1e-300)) - Math.log10(d.lo)) / (Math.log10(d.hi) - Math.log10(d.lo))
  return (v - d.lo) / (d.hi - d.lo)
}
