/**
 * tui.ts — OpenCode v2 CLI plugin: renderers for ```chart and ```spark blocks.
 * Auto-discovered from ~/.config/opencode/plugins/charts/.
 *
 * The model writes in the conversation:
 *
 *   ```chart
 *   {"type":"line","title":"UNRATE %","data":[["2024-10",4.1],["2024-11",4.2]]}
 *   ```
 *
 * and the TUI paints it as an inline braille chart — no PNGs, no external tools.
 */
import { Plugin } from "@opencode/plugin/tui"
import { BoxRenderable, TextRenderable, type Renderable } from "@opentui/core"
import { buildChart, buildFromPlainText, type ChartResult, type Run } from "./chart"

const BORDER = "#3B4261"
const ERROR = "#F7768E"

function plotWidth(renderer: unknown): number {
  const w = (renderer as { width?: number } | undefined)?.width ?? 90
  return Math.max(56, Math.min(110, w - 18))
}

function parseSpec(text: string, lang: string): unknown {
  const raw = text.trim()
  if (raw.startsWith("{") || raw.startsWith("[")) return JSON.parse(raw)
  return buildFromPlainText(raw, lang)
}

export default Plugin.define({
  id: "charts",
  setup(context) {
    const renderer = context.renderer

    // Anti-double-load guard: the host throws if a language is registered twice
    const g = globalThis as { __opencode_charts_registered?: boolean }
    if (g.__opencode_charts_registered) return
    g.__opencode_charts_registered = true

    // Probe: marker on disk + visible toast in the TUI
    try {
      const { writeFileSync } = require("node:fs") as typeof import("node:fs")
      writeFileSync(new URL("./.loaded", import.meta.url), new Date().toISOString())
    } catch {}
    try {
      context.ui.toast.show({ message: "charts plugin: chart/spark renderers active", variant: "success", duration: 4000 })
    } catch {}

    const renderBlock = (token: { text?: string; lang?: string }): Renderable | undefined => {
      const lang = token?.lang ?? "chart"
      let result: ChartResult
      try {
        const spec = parseSpec(token?.text ?? "", lang)
        result = buildChart(spec, { width: plotWidth(renderer) })
      } catch (firstError) {
        // If JSON fails, try bare numbers; if that fails too, error box
        try {
          result = buildFromPlainText(token?.text ?? "", lang, { width: plotWidth(renderer) })
        } catch {
          const err = new BoxRenderable(renderer, {
            flexDirection: "column",
            border: true,
            borderStyle: "rounded",
            borderColor: ERROR,
            paddingX: 1,
            marginBottom: 1,
          })
          err.add(
            new TextRenderable(renderer, {
              content: `chart: ${firstError instanceof Error ? firstError.message : String(firstError)}`,
              fg: ERROR,
            }),
          )
          return err
        }
      }

      const card = new BoxRenderable(renderer, {
        flexDirection: "column",
        border: true,
        borderStyle: "rounded",
        borderColor: BORDER,
        title: result.title ? ` ◇ ${result.title} ` : undefined,
        titleAlignment: "left",
        paddingX: 1,
        marginBottom: 1,
        width: "100%",
      })

      for (const row of result.rows) {
        if (row.length === 1) {
          card.add(new TextRenderable(renderer, { content: row[0].text, fg: row[0].fg }))
        } else {
          const line = new BoxRenderable(renderer, { flexDirection: "row" })
          for (const run of row as Run[]) {
            line.add(new TextRenderable(renderer, { content: run.text, fg: run.fg }))
          }
          card.add(line)
        }
      }
      return card
    }

    const offChart = context.markdown.registerCodeBlockRenderer("chart", renderBlock)
    const offSpark = context.markdown.registerCodeBlockRenderer("spark", renderBlock)

    return () => {
      offChart()
      offSpark()
    }
  },
})
