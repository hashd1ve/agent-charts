#!/usr/bin/env bun
/**
 * sync-claude-mod.ts — copies the chart engine and the prompt into the
 * Claude Code plugin (claude-code/hooks/). A Claude Code plugin may only
 * import files inside its own folder, so it carries a copy; run this after
 * changing engine/ or prompt.ts (the tests fail when the copy is stale).
 *
 *   bun scripts/sync-claude-mod.ts [--check]
 */
import { cpSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const hooks = join(root, "claude-code", "hooks")
const PAIRS: [string, string][] = [
  [join(root, "engine"), join(hooks, "engine")],
  [join(root, "prompt.ts"), join(hooks, "prompt.ts")],
]

function files(p: string): string[] {
  if (statSync(p).isFile()) return [p]
  return readdirSync(p).flatMap((f) => files(join(p, f)))
}

if (process.argv.includes("--check")) {
  const stale: string[] = []
  for (const [src, dst] of PAIRS) {
    const base = statSync(src).isFile() ? src : src + "/"
    for (const f of files(src)) {
      const twin = statSync(src).isFile() ? dst : join(dst, relative(base, f))
      let same = false
      try {
        same = readFileSync(twin, "utf8") === readFileSync(f, "utf8")
      } catch {}
      if (!same) stale.push(relative(root, twin))
    }
  }
  if (stale.length) {
    console.error(`stale copies (run bun scripts/sync-claude-mod.ts):\n  ${stale.join("\n  ")}`)
    process.exit(1)
  }
  console.log("claude-code/hooks is in sync")
} else {
  for (const [src, dst] of PAIRS) {
    rmSync(dst, { recursive: true, force: true })
    cpSync(src, dst, { recursive: true })
  }
  console.log("synced engine/ and prompt.ts → claude-code/hooks/")
}
