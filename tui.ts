/**
 * tui.ts — OpenCode v2 CLI plugin: renders ```chart and ```spark code blocks
 * as inline terminal charts (see render.ts for the OpenTUI side and
 * engine/ for the chart engine).
 *
 * The model writes in the conversation:
 *
 *   ```chart
 *   {"type":"line","title":"Unemployment (%)","unit":"%","data":[["2024-10",4.1],["2024-11",4.2]]}
 *   ```
 *
 * Plugin options (cli.json): { "maxWidth": 140, "languages": ["chart", "spark"], "toast": false }
 */
import { Plugin } from "@opencode/plugin/tui"
// Must be imported here, in the entry file: the host maps it to its own
// runtime instance only for the entry (see render.ts).
import { BoxRenderable, RGBA, StyledText, TextAttributes, TextRenderable } from "@opentui/core"
import { createChartBlockRenderer, themeFromTokens } from "./render"
import type { Theme } from "./engine/types"

const DEFAULT_LANGUAGES = ["chart", "spark"]

export default Plugin.define({
  id: "charts",
  setup(context) {
    const options = (context.options ?? {}) as { maxWidth?: number; languages?: string[]; toast?: boolean }

    // Theme tokens are a live getter; convert once per token object.
    let cachedTokens: unknown
    let cachedMode: string | undefined
    let cachedTheme: Theme | undefined
    const theme = (): Theme => {
      const tokens = context.theme
      const mode = context.themeMode
      if (!cachedTheme || tokens !== cachedTokens || mode !== cachedMode) {
        cachedTokens = tokens
        cachedMode = mode
        cachedTheme = themeFromTokens(tokens, mode)
      }
      return cachedTheme
    }

    const tui = { BoxRenderable, TextRenderable, StyledText, RGBA, TextAttributes }
    const render = createChartBlockRenderer(tui, context.renderer, {
      theme,
      maxWidth: typeof options.maxWidth === "number" ? options.maxWidth : undefined,
    })

    const languages = Array.isArray(options.languages) && options.languages.length ? options.languages : DEFAULT_LANGUAGES
    const offs: (() => void)[] = []
    for (const lang of languages) {
      try {
        offs.push(context.markdown.registerCodeBlockRenderer(lang, render))
      } catch {
        // already registered (another plugin owns this language): skip it
      }
    }

    if (options.toast) {
      try {
        context.ui.toast.show({ message: `charts: ${languages.join(", ")} blocks render inline`, variant: "success", duration: 3000 })
      } catch {}
    }

    return () => {
      for (const off of offs.splice(0)) off()
    }
  },
})
