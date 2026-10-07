/**
 * types.ts — shared types of the chart engine.
 *
 * The engine is pure: a spec goes in, rows of styled "runs" come out. A run is
 * a span of text with an optional foreground/background color; the TUI bridge
 * (render.ts) maps runs onto OpenTUI text chunks, the demo script onto ANSI.
 */

export type Run = { text: string; fg?: string; bg?: string; bold?: boolean }

export type Row = Run[]

export type ChartResult = {
  title?: string
  rows: Row[]
}

export type Theme = {
  mode: "dark" | "light"
  /** Categorical series colors. */
  palette: string[]
  /** Primary labels and values. */
  text: string
  /** Axis labels, legends, secondary text. */
  muted: string
  /** Grid dots, tracks, empty cells. */
  grid: string
  /** Positive / bullish. */
  up: string
  /** Negative / bearish. */
  down: string
  /** Reference lines, thresholds. */
  warn: string
  info: string
  /** Terminal background, used to blend tints and pick readable text. */
  background: string
}

export type BuildOptions = {
  /** Columns available for the chart body (inside the card). */
  width?: number
  theme?: Partial<Theme>
}

/** What every chart renderer receives. */
export type Ctx = {
  width: number
  theme: Theme
}

// biome-ignore lint: specs are free-form JSON written by a model
export type Spec = Record<string, any>
