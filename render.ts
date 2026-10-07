/**
 * render.ts — bridge between the chart engine and OpenTUI.
 *
 * Each ```chart block becomes a bordered card holding a single TextRenderable
 * whose content is StyledText (fg + bg per run). The card listens to its own
 * layout size: when the real width differs from the guess used for the first
 * paint (sidebar open, terminal resized), the chart is rebuilt to fit.
 *
 * OpenTUI classes are injected (see tui.ts) rather than imported here: the
 * host only maps `@opentui/core` to its own runtime instance for the plugin's
 * entry file, and renderables from a second copy of the library can't paint
 * into the host's buffers.
 */
import type * as OpenTUI from "@opentui/core"
import type { BoxRenderable, CliRenderer, Renderable, RGBA, StyledText } from "@opentui/core"
import { buildChart, parseBlock } from "./engine"
import { rowWidth } from "./engine/grid"
import { strWidth } from "./engine/text"
import { DARK, LIGHT, isHex, mix, rgbToHex } from "./engine/theme"
import type { ChartResult, Row, Theme } from "./engine/types"

/* ------------------------------------------------------------------ */
/* Theme: OpenCode tokens → engine Theme                               */
/* ------------------------------------------------------------------ */

type Color = unknown

function hexOf(c: Color): string | undefined {
  if (typeof c === "string") return isHex(c) ? c.slice(0, 7) : undefined
  if (!c || typeof c !== "object") return undefined
  const rgba = c as { toInts?: () => number[]; r?: number; g?: number; b?: number; a?: number }
  if (typeof rgba.a === "number" && rgba.a === 0) return undefined
  if (typeof rgba.toInts === "function") {
    const [r, g, b] = rgba.toInts()
    return rgbToHex(r, g, b)
  }
  if (typeof rgba.r === "number" && typeof rgba.g === "number" && typeof rgba.b === "number") {
    return rgbToHex(rgba.r * 255, rgba.g * 255, rgba.b * 255)
  }
  return undefined
}

/**
 * Reads the resolved OpenCode theme (context.theme). Every token is optional:
 * anything missing falls back to TokyoNight so a theme change can't break us.
 */
// biome-ignore lint: the theme is an untyped token tree
export function themeFromTokens(tokens: any, mode: "dark" | "light" | undefined): Theme {
  const base = mode === "light" ? LIGHT : DARK
  if (!tokens || typeof tokens !== "object") return base
  const pick = (...cands: Color[]) => {
    for (const c of cands) {
      const h = hexOf(c)
      if (h) return h
    }
    return undefined
  }
  try {
    const palette: string[] = Array.isArray(tokens.categorical)
      ? tokens.categorical.map((ramp: Record<number, Color>) => pick(ramp?.[200], ramp?.[300])).filter(Boolean)
      : []
    const fb = tokens.text?.feedback ?? {}
    const background = pick(tokens.background?.base) ?? base.background
    const text = pick(tokens.text?.base, tokens.markdown?.text) ?? base.text
    const muted = pick(tokens.text?.muted) ?? base.muted
    return {
      mode: mode ?? base.mode,
      palette: palette.length >= 3 ? palette : base.palette,
      text,
      muted,
      grid: mix(background, muted, 0.55),
      up: pick(fb.success?.base) ?? base.up,
      down: pick(fb.error?.base) ?? base.down,
      warn: pick(fb.warning?.base) ?? base.warn,
      info: pick(fb.info?.base) ?? base.info,
      background,
    }
  } catch {
    return base
  }
}

/* ------------------------------------------------------------------ */
/* Rows → StyledText                                                   */
/* ------------------------------------------------------------------ */

/** The slice of @opentui/core this module needs, supplied by the caller. */
export type TuiLib = Pick<typeof OpenTUI, "BoxRenderable" | "TextRenderable" | "StyledText" | "RGBA" | "TextAttributes">

const rgbaCache = new WeakMap<TuiLib, Map<string, RGBA>>()
function rgba(tui: TuiLib, hex: string | undefined): RGBA | undefined {
  if (!hex) return undefined
  let cache = rgbaCache.get(tui)
  if (!cache) rgbaCache.set(tui, (cache = new Map()))
  let c = cache.get(hex)
  if (!c) {
    c = tui.RGBA.fromHex(hex)
    cache.set(hex, c)
  }
  return c
}

export function toStyledText(tui: TuiLib, rows: Row[]): StyledText {
  const chunks: ConstructorParameters<typeof OpenTUI.StyledText>[0] = []
  rows.forEach((row, i) => {
    if (i > 0) chunks.push({ __isChunk: true, text: "\n" })
    for (const run of row) {
      chunks.push({
        __isChunk: true,
        text: run.text,
        fg: rgba(tui, run.fg),
        bg: rgba(tui, run.bg),
        attributes: run.bold ? tui.TextAttributes.BOLD : 0,
      })
    }
  })
  return new tui.StyledText(chunks)
}

/* ------------------------------------------------------------------ */
/* Code block renderer                                                 */
/* ------------------------------------------------------------------ */

export type RendererOptions = {
  /** Current theme; called on every (re)build so theme switches apply. */
  theme?: () => Theme
  /** Upper bound for the chart body width. */
  maxWidth?: number
}

type CodeToken = { text?: string; lang?: string; raw?: string }

/** A fenced block is complete once its closing fence has streamed in. */
export function isClosed(token: CodeToken): boolean {
  const raw = (token.raw ?? "").trimEnd()
  if (!raw) return true
  const lines = raw.split("\n")
  const open = /^\s*(`{3,}|~{3,})/.exec(lines[0])?.[1]
  if (!open) return true
  return lines.length >= 2 && new RegExp(`^\\s*${open[0]}{${open.length},}\\s*$`).test(lines[lines.length - 1])
}

const BORDER_AND_PADDING = 4 // rounded border (2) + paddingX 1 on each side

/** Full width for wide charts; snug for narrow ones. */
function cardWidth(res: ChartResult, inner: number): number | "100%" {
  const natural = Math.max(1, ...res.rows.map(rowWidth), res.title ? strWidth(res.title) + 6 : 0)
  return natural >= inner - 8 ? "100%" : natural + BORDER_AND_PADDING
}

export function createChartBlockRenderer(tui: TuiLib, renderer: CliRenderer, opts: RendererOptions = {}) {
  const { BoxRenderable, TextRenderable } = tui
  const theme = () => opts.theme?.() ?? DARK
  const maxWidth = opts.maxWidth ?? 140
  const guessWidth = () => {
    const w = (renderer as { width?: number } | undefined)?.width ?? 100
    return Math.max(24, Math.min(maxWidth, w - 10 - BORDER_AND_PADDING))
  }

  const errorCard = (message: string): Renderable => {
    const t = theme()
    const box = new BoxRenderable(renderer, {
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: t.down,
      title: " chart ",
      titleAlignment: "left",
      paddingX: 1,
      marginBottom: 1,
    })
    box.add(new TextRenderable(renderer, { content: message, fg: t.down }))
    box.add(new TextRenderable(renderer, { content: 'expected e.g. {"type":"line","data":[["2024-01",4.1],["2024-02",4.3]]}', fg: t.muted }))
    return box
  }

  return (token: CodeToken): Renderable | undefined => {
    const lang = token?.lang ?? "chart"
    const text = token?.text ?? ""

    let spec: ReturnType<typeof parseBlock>
    let first: ChartResult
    let width = guessWidth()
    try {
      spec = parseBlock(text, lang)
      first = buildChart(spec, { width, theme: theme() })
    } catch (e) {
      // still streaming: the JSON is just incomplete, show a quiet placeholder
      if (!isClosed(token)) {
        return new TextRenderable(renderer, { content: `◇ ${lang} · drawing…`, fg: theme().muted, marginBottom: 1 })
      }
      return errorCard(`chart: ${e instanceof Error ? e.message : String(e)}`)
    }

    const t = theme()
    const body = new TextRenderable(renderer, {
      content: toStyledText(tui, first.rows),
      height: Math.max(1, first.rows.length),
      width: "100%",
      wrapMode: "none",
    })
    const card = new BoxRenderable(renderer, {
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: t.grid,
      title: first.title ? ` ◇ ${first.title} ` : undefined,
      titleAlignment: "left",
      paddingX: 1,
      width: cardWidth(first, width),
    })
    card.add(body)
    // full-width frame: measures the space we really have, while the card
    // itself can hug narrow charts (gauges, pies, sparklines)
    const frame = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", marginBottom: 1 })
    frame.add(card)

    let pending = false
    frame.onSizeChange = function (this: BoxRenderable) {
      // the engine's floor is 20 columns; below that the card clips, but it
      // still repaints at the smallest size instead of keeping a wide paint
      const inner = Math.max(20, Math.min(maxWidth, Math.floor(this.width) - BORDER_AND_PADDING))
      if (inner === width || pending) return
      pending = true
      // onSizeChange fires inside the render pass; rebuild right after it
      const rebuild = () => {
        pending = false
        if (frame.isDestroyed) return
        try {
          const res = buildChart(spec, { width: inner, theme: theme() })
          width = inner
          body.content = toStyledText(tui, res.rows)
          body.height = Math.max(1, res.rows.length)
          card.width = cardWidth(res, inner)
          frame.requestRender()
        } catch {
          // keep the previous paint
        }
      }
      if (typeof process !== "undefined" && typeof process.nextTick === "function") process.nextTick(rebuild)
      else setTimeout(rebuild, 0)
    }
    return frame
  }
}
