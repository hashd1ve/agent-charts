/**
 * index.ts — server-side entry point of the "charts" plugin.
 * All the visual work happens in tui.ts (CLI plugin); there are no hooks here.
 */
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "charts",
  setup() {},
})
