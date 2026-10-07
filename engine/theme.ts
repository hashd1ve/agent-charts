/**
 * theme.ts — palettes, color math and color ramps.
 * The TUI passes the active OpenCode theme; DARK/LIGHT (TokyoNight Night/Day)
 * are the fallbacks for the demo script and for themes we can't read.
 */
import type { Theme } from "./types"

export const DARK: Theme = {
  mode: "dark",
  palette: ["#7AA2F7", "#9ECE6A", "#FF9E64", "#BB9AF7", "#2AC3DE", "#E0AF68", "#F7768E", "#73DACA"],
  text: "#C0CAF5",
  muted: "#787C99",
  grid: "#4E5579",
  up: "#9ECE6A",
  down: "#F7768E",
  warn: "#E0AF68",
  info: "#2AC3DE",
  background: "#1A1B26",
}

export const LIGHT: Theme = {
  mode: "light",
  palette: ["#2E7DE9", "#587539", "#B15C00", "#9854F1", "#007197", "#8C6C3E", "#F52A65", "#118C74"],
  text: "#3760BF",
  muted: "#6172B0",
  grid: "#A8AECB",
  up: "#587539",
  down: "#F52A65",
  warn: "#8C6C3E",
  info: "#007197",
  background: "#E1E2E7",
}

export function resolveTheme(partial?: Partial<Theme>): Theme {
  const base = partial?.mode === "light" ? LIGHT : DARK
  const out = { ...base, palette: [...base.palette] }
  if (!partial) return out
  for (const [k, v] of Object.entries(partial)) {
    if (k === "palette") {
      if (Array.isArray(v) && v.length > 0 && v.every(isHex)) out.palette = v
    } else if (k === "mode") {
      if (v === "light" || v === "dark") out.mode = v
    } else if (typeof v === "string" && isHex(v)) {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Color math                                                          */
/* ------------------------------------------------------------------ */

export function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(v)
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "")
  if (h.length === 3) h = h.replace(/./g, "$&$&")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Linear blend from a (t=0) to b (t=1). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const k = Math.max(0, Math.min(1, t))
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k)
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Text color that reads best on top of `bg`. */
export function readableOn(bg: string, theme: Theme): string {
  const dark = theme.mode === "dark" ? theme.background : theme.text
  const light = theme.mode === "dark" ? theme.text : theme.background
  return contrast(bg, dark) >= contrast(bg, light) ? dark : light
}

/* ------------------------------------------------------------------ */
/* Ramps                                                               */
/* ------------------------------------------------------------------ */

function ramp(stops: string[]): (t: number) => string {
  return (t: number) => {
    const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1)
    const i = Math.min(stops.length - 2, Math.floor(k))
    return mix(stops[i], stops[i + 1], k - i)
  }
}

/** Low → high, t ∈ [0,1]: faint tint → primary → green → yellow. */
export function sequential(theme: Theme): (t: number) => string {
  const p = theme.palette[0]
  return ramp([mix(theme.background, p, 0.22), p, theme.up, theme.warn])
}

/** Negative → zero → positive, t ∈ [-1,1]. */
export function diverging(theme: Theme): (t: number) => string {
  const mid = mix(theme.background, theme.muted, 0.3)
  const neg = ramp([mid, theme.down])
  const pos = ramp([mid, theme.up])
  return (t: number) => (t < 0 ? neg(-t) : pos(t))
}

export function seriesColor(theme: Theme, i: number, override?: unknown): string {
  return isHex(override) ? override : theme.palette[i % theme.palette.length]
}
