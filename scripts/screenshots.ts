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
import { cardHtml, cellCss } from "./lib/cells"

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

function page(res: ChartResult): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:${BG}}
  body{padding:40px;display:inline-block}
  ${cellCss({ cw: 8.5, ch: 19, fs: 14, bg: BG, border: CARD_BORDER })}
</style></head><body>${cardHtml(res)}</body></html>`
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
