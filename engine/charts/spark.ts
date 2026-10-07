/**
 * spark.ts — one-line sparklines. One series renders as a single line with
 * its last value and change; several series render as a compact table
 * (name · sparkline · last · change), handy for watchlists and dashboards.
 */
import { fmtPct, fmtValue } from "../format"
import { clampInt, readSeries, sortByDate, str } from "../spec"
import { padEnd, padStart, strWidth, truncate } from "../text"
import { seriesColor } from "../theme"
import type { ChartResult, Ctx, Row, Spec, Theme } from "../types"

const BLOCKS = "▁▂▃▄▅▆▇█"

/** Averages buckets so the series fits in `w` columns (nulls stay gaps). */
export function resample(values: (number | null)[], w: number): (number | null)[] {
  if (values.length <= w) return values
  const out: (number | null)[] = []
  for (let i = 0; i < w; i++) {
    const a = Math.floor((i * values.length) / w)
    const b = Math.floor(((i + 1) * values.length) / w)
    const bucket = values.slice(a, Math.max(a + 1, b)).filter((v): v is number => v !== null)
    out.push(bucket.length ? bucket.reduce((x, y) => x + y, 0) / bucket.length : null)
  }
  return out
}

export function sparkline(values: (number | null)[], lo?: number, hi?: number): string {
  const nums = values.filter((v): v is number => v !== null)
  const min = lo ?? Math.min(...nums)
  const max = hi ?? Math.max(...nums)
  const range = max - min
  return values.map((v) => (v === null ? " " : BLOCKS[range === 0 ? 3 : Math.round(((v - min) / range) * 7)])).join("")
}

function change(first: number, last: number, unitStr: string, theme: Theme): { text: string; color: string } {
  const diff = last - first
  const color = diff > 0 ? theme.up : diff < 0 ? theme.down : theme.muted
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "•"
  const text = first > 0 && unitStr !== "%" ? fmtPct((diff / first) * 100) : fmtValue(diff, unitStr === "%" ? "" : unitStr, { sign: true })
  return { text: `${arrow} ${text}`, color }
}

export function renderSpark(spec: Spec, ctx: Ctx): ChartResult {
  const { theme } = ctx
  const unitStr = str(spec.unit)
  const series = readSeries(spec).map((s) => ({ ...s, pairs: sortByDate(s.pairs, (p) => p[0]) }))
  const width = Math.min(ctx.width, 160)
  const rows: Row[] = []

  if (series.length === 1) {
    const vals = series[0].pairs.map((p) => p[1])
    const nums = vals.filter((v): v is number => v !== null)
    if (nums.length === 0) throw new Error("spark: no numeric values")
    const first = nums[0]
    const last = nums[nums.length - 1]
    const ch = change(first, last, unitStr, theme)
    const tail: Row = []
    if (spec.stats !== false) {
      tail.push({ text: `  ${fmtValue(last, unitStr)}`, fg: theme.text, bold: true })
      if (nums.length > 1) tail.push({ text: `  ${ch.text}`, fg: ch.color })
      tail.push({ text: `  ${fmtValue(Math.min(...nums), unitStr)}–${fmtValue(Math.max(...nums), unitStr)}`, fg: theme.muted })
    }
    // the sparkline keeps at least 8 columns: drop range, then change, then last
    const tailW = () => tail.reduce((a, r) => a + strWidth(r.text), 0)
    while (tail.length && width - tailW() < 8) tail.pop()
    const w = Math.max(1, Math.min(clampInt(spec.width, 8, 400, 80), width - tailW()))
    const row: Row = [{ text: sparkline(resample(vals, w)), fg: seriesColor(theme, 0, series[0].color ?? spec.color) }, ...tail]
    rows.push(row)
    return { title: str(spec.title) || undefined, rows }
  }

  // watchlist table
  const names = series.map((s) => s.name)
  let nameW = Math.min(16, Math.max(...names.map(strWidth)))
  const data = series.map((s) => {
    const vals = s.pairs.map((p) => p[1])
    const nums = vals.filter((v): v is number => v !== null)
    const last = nums[nums.length - 1]
    return { vals, last: nums.length ? fmtValue(last, unitStr) : "–", ch: nums.length > 1 ? change(nums[0], last, unitStr, theme) : { text: "", color: theme.muted } }
  })
  let lastW = Math.max(...data.map((d) => strWidth(d.last)))
  let chW = Math.max(...data.map((d) => strWidth(d.ch.text)))
  const longest = Math.max(...data.map((d) => d.vals.length))
  // narrow: drop the change column, then shorten names, then drop last values
  const fixed = () => nameW + 2 + (lastW ? 2 + lastW : 0) + (chW ? 2 + chW : 0)
  if (fixed() + 4 > width) chW = 0
  if (fixed() + 4 > width) nameW = Math.max(3, width - 4 - fixed() + nameW)
  if (fixed() + 4 > width) lastW = 0
  const sparkW = Math.max(1, Math.min(longest, clampInt(spec.width, 4, 400, 60), width - fixed()))
  const shared = spec.shared === true
  const all = data.flatMap((d) => d.vals.filter((v): v is number => v !== null))
  series.forEach((s, i) => {
    const d = data[i]
    rows.push([
      { text: padEnd(truncate(s.name, nameW), nameW) + "  ", fg: theme.text },
      { text: padEnd(sparkline(resample(d.vals, sparkW), shared ? Math.min(...all) : undefined, shared ? Math.max(...all) : undefined), sparkW), fg: seriesColor(theme, i, s.color) },
      ...(lastW ? [{ text: `  ${padStart(d.last, lastW)}`, fg: theme.text }] : []),
      ...(chW ? [{ text: `  ${padStart(d.ch.text, chW)}`, fg: d.ch.color }] : []),
    ])
  })
  return { title: str(spec.title) || undefined, rows }
}
