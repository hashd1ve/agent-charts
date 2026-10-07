/**
 * index.ts — server-side entry of the "charts" plugin.
 *
 * Rendering happens in tui.ts. Here we only teach the model the ```chart
 * format by appending a short cheat sheet (prompt.ts) to the system prompt,
 * so every session knows the chart types without editing AGENTS.md.
 * Disable with the plugin option { "prompt": false }.
 */
import type { Plugin } from "@opencode/plugin"
import { CHART_PROMPT, PROMPT_MARKER } from "./prompt"

// A plain object (Plugin.define is the identity): the server doesn't provide
// @opencode/plugin to plugins, so a runtime import would need node_modules.
const charts: Plugin.Plugin = {
  id: "charts",
  async setup(context) {
    const options = (context.options ?? {}) as { prompt?: boolean }
    if (options.prompt === false) return
    try {
      const reg = await context.session.hook("context", (input) => {
        if (input.system.some((part) => part.type === "text" && part.text.includes(PROMPT_MARKER))) return
        input.system.push({ type: "text", text: CHART_PROMPT })
      })
      return () => reg.dispose()
    } catch {
      // older hosts without session hooks: rendering still works, the model
      // just needs the format from AGENTS.md instead
    }
  },
}

export default charts
