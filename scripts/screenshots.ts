#!/usr/bin/env bun
/**
 * screenshots.ts — renders examples to PNG for the README (docs/screenshots/).
 *
 * Each chart becomes an HTML page laid out on a fixed cell grid, the way a
 * terminal draws it: block elements (█ ▁…▇ ▏…▉ ▀ ▐ ▕ ▔) are painted as exact
 * CSS fills rather than font glyphs, so bars and pies tile without seams.
 * Headless Chrome photographs the page and ImageMagick trims it.
 *
 *   bun scripts/screenshots.ts [name filter…]
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildChart, DARK, type ChartResult } from "../chart"
import { EXAMPLES } from "../examples"

const root = resolve(import.meta.dir, "..")
const outDir = join(root, "docs", "screenshots")
const tmp = join(process.env.TMPDIR ?? "/tmp", "agent-charts-shots")
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const WIDTH = 78
const BG = "#1A1B26"
const CARD_BORDER = "#3B4261"

const SHOTS: Record<string, string> = {
  "line multi-series + reference": "line",
  "area log scale": "area-log",
  "area stacked": "area-stacked",
  drawdown: "drawdown",
  step: "step",
  "scatter + trend": "scatter",
  "bar diverging": "bar",
  "bar stacked": "bar-stacked",
  "column grouped": "column",
  hist: "hist",
  heat: "heat",
  calendar: "calendar",
  candle: "candle",
  donut: "donut",
  pie: "pie",
  gauge: "gauge",
  stat: "stat",
  dumbbell: "dumbbell",
  box: "box",
  waterfall: "waterfall",
  "spark watchlist": "watchlist",
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// box drawing as strokes from the cell center: up, right, down, left; 1 light, 2 heavy
type Arms = [number, number, number, number]
const BOX: Record<string, Arms> = {
  "─": [0, 1, 0, 1], "━": [0, 2, 0, 2], "│": [1, 0, 1, 0], "┃": [2, 0, 2, 0],
  "┤": [1, 0, 1, 1], "├": [1, 1, 1, 0], "┬": [0, 1, 1, 1], "┴": [1, 1, 0, 1], "┼": [1, 1, 1, 1],
  "└": [1, 1, 0, 0], "┘": [1, 0, 0, 1], "┌": [0, 1, 1, 0], "┐": [0, 0, 1, 1],
  "╷": [0, 0, 1, 0], "╵": [1, 0, 0, 0], "╻": [0, 0, 2, 0], "╹": [2, 0, 0, 0], "╽": [1, 0, 2, 0], "╿": [2, 0, 1, 0],
}
const ROUND: Record<string, "tl" | "tr" | "bl" | "br"> = { "╭": "tl", "╮": "tr", "╰": "bl", "╯": "br" }
const DASH: Record<string, "h" | "v"> = { "┄": "h", "┈": "h", "┊": "v", "┆": "v" }

function boxCell(ch: string, fg: string, bg?: string): string | undefined {
  const base = `position:relative${bg ? `;background:${bg}` : ""}`
  const w = (k: number) => (k === 2 ? 3 : 1.5)
  if (BOX[ch]) {
    const [u, r, d, l] = BOX[ch]!
    const seg: string[] = []
    if (u) seg.push(`left:calc(50% - ${w(u) / 2}px);top:0;width:${w(u)}px;height:50%`)
    if (d) seg.push(`left:calc(50% - ${w(d) / 2}px);top:50%;width:${w(d)}px;height:50%`)
    if (l) seg.push(`top:calc(50% - ${w(l) / 2}px);left:0;height:${w(l)}px;width:50%`)
    if (r) seg.push(`top:calc(50% - ${w(r) / 2}px);left:50%;height:${w(r)}px;width:50%`)
    // overlap the arms a hair so joints have no notch
    const fill = seg.map((g) => `<b style="position:absolute;background:${fg};${g}"></b>`).join("")
    return `<i style="${base}">${fill}</i>`
  }
  if (ROUND[ch]) {
    const c = ROUND[ch] as "tl" | "tr" | "bl" | "br"
    const pos = { tl: "left:50%;top:50%", tr: "right:50%;top:50%", bl: "left:50%;bottom:50%", br: "right:50%;bottom:50%" }[c]
    const borders = { tl: "border-top-left-radius", tr: "border-top-right-radius", bl: "border-bottom-left-radius", br: "border-bottom-right-radius" }[c]
    const sides = { tl: "border-top;border-left", tr: "border-top;border-right", bl: "border-bottom;border-left", br: "border-bottom;border-right" }[c]
    const line = sides.split(";").map((side) => `${side}:1.5px solid ${fg}`).join(";")
    return `<i style="${base}"><b style="position:absolute;${pos};width:calc(50% + 0.75px);height:calc(50% + 0.75px);box-sizing:border-box;${line};${borders}:6px;margin:-0.75px"></b></i>`
  }
  if (DASH[ch]) {
    const g = DASH[ch] === "h"
      ? `left:0;right:0;top:calc(50% - 0.75px);height:1.5px;background:repeating-linear-gradient(to right,${fg} 0 2px,transparent 2px 4px)`
      : `top:0;bottom:0;left:calc(50% - 0.75px);width:1.5px;background:repeating-linear-gradient(to bottom,${fg} 0 3px,transparent 3px 6px)`
    return `<i style="${base}"><b style="position:absolute;${g}"></b></i>`
  }
  return undefined
}

const LOWER = "▁▂▃▄▅▆▇"
const LEFT = "▏▎▍▌▋▊▉"

/** One terminal cell as HTML: fills for block elements, a glyph otherwise. */
function cell(ch: string, fg = "#c0caf5", bg?: string): string {
  const back = bg ?? "transparent"
  const fill = (dir: string, pct: number) => `background:linear-gradient(${dir},${fg} ${pct}%,${back} ${pct}%)`
  let style: string | undefined
  if (ch === "█") style = `background:${fg}`
  else if (LOWER.includes(ch)) style = fill("to top", ((LOWER.indexOf(ch) + 1) / 8) * 100)
  else if (LEFT.includes(ch)) style = fill("to right", ((LEFT.indexOf(ch) + 1) / 8) * 100)
  else if (ch === "▀") style = fill("to bottom", 50)
  else if (ch === "▐") style = fill("to left", 50)
  else if (ch === "▕") style = fill("to left", 12.5)
  else if (ch === "▔") style = fill("to bottom", 12.5)
  if (style) return `<i style="${style}"></i>`
  const box = boxCell(ch, fg, bg)
  if (box) return box
  const bgStyle = bg ? `;background:${bg}` : ""
  const cls = ch >= "⠀" && ch <= "⣿" ? ' class="b"' : ""
  return `<i${cls} style="color:${fg}${bgStyle}">${ch === " " ? "&nbsp;" : esc(ch)}</i>`
}

function page(res: ChartResult): string {
  const rows = res.rows
    .map((row) => {
      let html = ""
      for (const run of row) {
        for (const ch of run.text) {
          const c = cell(ch, run.fg, run.bg)
          html += run.bold ? c.replace("<i", '<i data-b="1"') : c
        }
      }
      return `<div class="r">${html || "&nbsp;"}</div>`
    })
    .join("\n")
  const title = res.title ? `<div class="t">◇ ${esc(res.title)}</div>` : ""
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:${BG}}
  body{padding:40px;display:inline-block}
  .card{display:inline-block;border:1.5px solid ${CARD_BORDER};border-radius:10px;padding:12px 16px 14px;background:${BG}}
  .t{font:600 15px Menlo,monospace;color:#c0caf5;margin:0 0 8px}
  .r{height:19px;white-space:nowrap;font:14px Menlo,monospace;line-height:19px}
  i{display:inline-block;width:8.5px;height:19px;font-style:normal;text-align:center;vertical-align:top;overflow:hidden}
  i[data-b]{font-weight:700}
  i.b{font-size:19px;line-height:19px}
</style></head><body><div class="card">${title}${rows}</div></body></html>`
}

async function run(cmd: string[]): Promise<void> {
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" })
  const code = await p.exited
  if (code !== 0) throw new Error(`${cmd[0]} failed: ${await new Response(p.stderr).text()}`)
}

mkdirSync(outDir, { recursive: true })
mkdirSync(tmp, { recursive: true })
const filters = process.argv.slice(2)
for (const ex of EXAMPLES) {
  const name = SHOTS[ex.name]
  if (!name || (filters.length && !filters.some((f) => name.includes(f)))) continue
  const res = buildChart(ex.spec, { width: WIDTH, theme: DARK })
  const html = join(tmp, `${name}.html`)
  const raw = join(tmp, `${name}.png`)
  writeFileSync(html, page(res))
  await run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", "--window-size=1100,900", `--screenshot=${raw}`, `file://${html}`])
  // trim to the card, then a uniform margin
  await run(["magick", raw, "-trim", "+repage", "-bordercolor", BG, "-border", "36", join(outDir, `${name}.png`)])
  console.log(`docs/screenshots/${name}.png`)
}
