#!/usr/bin/env bun
/**
 * install.ts — copies the plugin's runtime files into an OpenCode plugins
 * directory (default ~/.config/opencode/plugins/charts), backing up whatever
 * was there, and checks that cli.json lists it.
 *
 *   bun scripts/install.ts [target-dir]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "..")
const configDir = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode")
const target = resolve(process.argv[2] ?? join(configDir, "plugins", "charts"))
const FILES = ["index.ts", "tui.ts", "render.ts", "chart.ts", "prompt.ts", "engine"]

const fail = (msg: string): never => {
  console.error(`install: ${msg}`)
  process.exit(1)
}
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep)
if (inside(root, target)) fail(`refusing to install over ${target}: it contains this repository`)
if (inside(target, root)) fail(`refusing to install inside the repository (${target})`)
if (existsSync(target)) {
  // only ever move aside something that is clearly a previous charts install
  const entries = readdirSync(target)
  const looksLikeCharts = entries.includes("tui.ts") && (entries.includes("chart.ts") || entries.includes("engine"))
  if (entries.length > 0 && !looksLikeCharts) {
    fail(`${target} exists and doesn't look like an opencode-charts install — pass the plugin directory itself (…/plugins/charts)`)
  }
}

if (existsSync(target) && readdirSync(target).length > 0) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const backup = join(dirname(target), "..", "plugins-backup", `charts-${stamp}`)
  mkdirSync(dirname(backup), { recursive: true })
  renameSync(target, backup)
  console.log(`backed up previous install → ${backup}`)
}
mkdirSync(target, { recursive: true })
for (const f of FILES) cpSync(join(root, f), join(target, f), { recursive: true })
rmSync(join(target, ".loaded"), { force: true })
console.log(`installed opencode-charts → ${target}`)

const cli = join(configDir, "cli.json")
let listed = false
try {
  const cfg = JSON.parse(readFileSync(cli, "utf8")) as { plugins?: (string | { package?: string })[] }
  listed = (cfg.plugins ?? []).some((p) => resolve((typeof p === "string" ? p : p.package ?? "").replace(/^~/, homedir())) === target)
} catch {}
if (!listed) {
  console.log(`\nadd it to ${cli}:\n  { "plugins": ["${target}"] }`)
} else {
  console.log("cli.json already lists it — running TUIs hot-reload the plugin, new ones pick it up on start")
}
