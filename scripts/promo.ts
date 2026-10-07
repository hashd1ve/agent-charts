#!/usr/bin/env bun
/// <reference lib="dom" />
/**
 * promo.ts — renders a short promo video (1920×1080, 30 fps, H.264) of the
 * charts in a terminal-like window: a prompt is typed, the reply shows the
 * "drawing…" placeholder, the chart wipes in, a quick montage of other types
 * follows, then an end card with the install line.
 *
 * The page is a deterministic timeline (window.render(t)); headless Chrome
 * (puppeteer-core, the system Chrome) photographs every frame and ffmpeg
 * encodes them.
 *
 *   bun scripts/promo.ts [out.mp4]      default promo/agent-charts.mp4
 */
import { mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import puppeteer from "puppeteer-core"
import { buildChart, DARK } from "../chart"
import { EXAMPLES } from "../examples"
import { cardHtml, cellCss } from "./lib/cells"

const root = resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const stillsAt = args.includes("--stills") ? (args[args.indexOf("--stills") + 1] ?? "").split(",").map(Number) : undefined
const out = resolve(args.find((a) => a.endsWith(".mp4")) ?? join(root, "promo", "agent-charts.mp4"))
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const FPS = 30
const DURATION = 17.5
const BG = "#1A1B26"
const BORDER = "#3B4261"

const spec = (name: string, extra: Record<string, unknown> = {}) => {
  const ex = EXAMPLES.find((e) => e.name === name)
  if (!ex) throw new Error(`no example ${name}`)
  return { ...ex.spec, ...extra }
}
const chart = (name: string, width: number, extra: Record<string, unknown> = {}, cls = "") =>
  cardHtml(buildChart(spec(name, extra), { width, theme: DARK }), cls)

// scene 1: the hook
const hero = chart("line multi-series + reference", 116, { height: 14 })
// scene 2: montage, one prompt → one chart each
const montage = [
  { prompt: "candles for ACME, last 6 weeks", html: chart("candle", 116, { height: 12 }) },
  { prompt: "monthly returns heatmap", html: chart("heat", 116) },
  { prompt: "markets today", html: chart("stat", 116) },
  { prompt: "portfolio allocation", html: chart("donut", 80, { height: 12 }) },
]
// scene 3: grid of small multiples
const grid = [
  chart("column grouped", 54, { height: 8 }, "small"),
  chart("dumbbell", 54, {}, "small"),
  chart("gauge", 54, {}, "small"),
  chart("waterfall", 54, {}, "small"),
  chart("spark watchlist", 54, {}, "small"),
  chart("box", 54, {}, "small"),
]

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0d0e15}
  #stage{position:relative;width:1920px;height:1080px;overflow:hidden;
    background:radial-gradient(1200px 700px at 50% 35%, #20223a 0%, #12131d 60%, #0b0c12 100%)}
  #cap{position:absolute;top:64px;left:0;right:0;text-align:center;font:700 52px Inter,-apple-system,sans-serif;
    letter-spacing:-0.5px;color:#e6e9f8}
  #cap small{display:block;margin-top:10px;font:500 24px Inter,-apple-system,sans-serif;color:#8b90b3;letter-spacing:0}
  #term{position:absolute;left:130px;top:186px;width:1660px;height:860px;border-radius:16px;background:${BG};
    border:1px solid #2a2e48;box-shadow:0 40px 120px rgba(0,0,0,.55);overflow:hidden}
  #bar{height:44px;display:flex;align-items:center;gap:9px;padding:0 18px;border-bottom:1px solid #24273d;background:#16171f}
  #bar b{width:13px;height:13px;border-radius:50%;display:inline-block}
  #bar span{flex:1;text-align:center;font:500 15px Menlo,monospace;color:#6b7094;margin-right:60px}
  .pane{position:absolute;left:44px;top:74px;right:44px}
  .prompt{font:25px Menlo,monospace;color:#c0caf5;height:34px;white-space:pre}
  .prompt .p{color:#7aa2f7}
  .cursor{display:inline-block;width:14px;height:28px;background:#c0caf5;vertical-align:-4px;margin-left:2px}
  .reply{margin-top:20px;display:flex;align-items:flex-start;gap:16px}
  .reply .dot{font:25px Menlo,monospace;color:#c0caf5;line-height:40px}
  .ph{font:23px Menlo,monospace;color:#6b7094;line-height:40px}
  ${cellCss({ cw: 12, ch: 26, fs: 19.9, bg: BG, border: BORDER })}
  #grid{position:absolute;left:0;right:0;top:215px;display:grid;grid-template-columns:repeat(3,auto);justify-content:center;align-items:start;gap:24px 24px}
  #grid .small .r{height:19px;line-height:19px;font-size:15.5px}
  #grid .small .r i{width:9.33px;height:19px}
  #grid .small .r i.b{font-size:19px;line-height:19px}
  #grid .small .t{font-size:16px;margin-bottom:8px}
  #grid .small{padding:10px 14px 12px}
  #end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  #end h1{margin:0;font:800 120px Menlo,monospace;color:#e6e9f8;letter-spacing:-3px}
  #end .tag{margin-top:14px;font:500 38px Inter,-apple-system,sans-serif;color:#a9b1d6}
  #end .who{margin-top:28px;font:600 30px Inter,-apple-system,sans-serif}
  #end .who .o{color:#7aa2f7}#end .who .c{color:#9ece6a}#end .who .s{color:#565f89;margin:0 14px}
  #end .cmd{margin-top:54px;padding:22px 34px;border-radius:14px;background:${BG};border:1px solid #2a2e48;
    font:26px Menlo,monospace;color:#c0caf5;min-width:900px;white-space:pre}
  #end .cmd .p{color:#7aa2f7}
  #end .url{margin-top:30px;font:500 28px Menlo,monospace;color:#7aa2f7}
  #end .meta{margin-top:16px;font:500 22px Inter,-apple-system,sans-serif;color:#6b7094}
</style></head><body><div id="stage">
  <div id="cap"></div>
  <div id="term">
    <div id="bar"><b style="background:#ff5f57"></b><b style="background:#febc2e"></b><b style="background:#28c840"></b><span>~/markets — agent</span></div>
    <div class="pane" id="s1">
      <div class="prompt"><span class="p">❯ </span><span id="p1"></span><span class="cursor" id="k1"></span></div>
      <div class="reply" id="r1"><span class="dot">⏺</span><div style="position:relative">
        <div class="ph" id="ph1">◇ chart · drawing…</div>
        <div id="w1" style="position:absolute;top:0;left:0">${hero}</div></div></div>
    </div>
    ${montage
      .map(
        (m, k) => `<div class="pane" id="s2-${k}">
      <div class="prompt"><span class="p">❯ </span><span id="p2-${k}"></span><span class="cursor" id="k2-${k}"></span></div>
      <div class="reply" id="r2-${k}"><span class="dot">⏺</span><div id="w2-${k}">${m.html}</div></div>
    </div>`,
      )
      .join("\n")}
  </div>
  <div id="grid">${grid.map((g, k) => `<div id="g-${k}">${g}</div>`).join("")}</div>
  <div id="end">
    <h1>agent-charts</h1>
    <div class="tag">Inline charts for AI coding agents</div>
    <div class="who"><span class="o">● OpenCode</span><span class="s">·</span><span class="c">● Claude Code</span></div>
    <div class="cmd"><span class="p">❯ </span><span id="cmd"></span><span class="cursor" id="kc"></span></div>
    <div class="url" id="url">github.com/hashd1ve/agent-charts</div>
    <div class="meta" id="meta">20 chart types · zero dependencies · works over SSH</div>
  </div>
</div>
<script>
const P1 = ${JSON.stringify("chart US inflation vs the Fed target")}
const P2 = ${JSON.stringify(montage.map((m) => m.prompt))}
const CMD = ${JSON.stringify("/plugin install charts --marketplace hashd1ve/agent-charts")}
const $ = (id) => document.getElementById(id)
const clamp = (x) => Math.max(0, Math.min(1, x))
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3)
const span = (t, a, b) => clamp((t - a) / (b - a))
const fade = (t, a, b, c, d) => Math.min(span(t, a, b), 1 - span(t, c, d))
function type(el, text, t, a, b) { el.textContent = text.slice(0, Math.round(text.length * span(t, a, b))) }
function cursor(el, t, a, b) { el.style.opacity = t >= a && t <= b && (t < a + 0.2 || t > b - 0.05 || Math.floor(t * 2.5) % 2 === 0) ? 1 : 0 }
const CAPS = [
  [0.0, 5.8, "Your coding agent can draw now", "Charts rendered right in the terminal — no images, no browser"],
  [6.0, 11.5, "Candles · heatmaps · KPI tiles · pies", "Ask in plain language, the agent writes a chart block"],
  [11.6, 13.7, "20 chart types, themed to your terminal", "Live while streaming · works over SSH"],
]
window.render = (t) => {
  // captions
  let cap = ""; let a = 0
  for (const [s, e, title, sub] of CAPS) if (t >= s - 0.01 && t <= e + 0.4) { cap = '<span>' + title + '</span><small>' + sub + '</small>'; a = fade(t, s, s + 0.45, e, e + 0.35) }
  $("cap").innerHTML = cap; $("cap").style.opacity = a
  $("cap").style.transform = 'translateY(' + (1 - a) * 12 + 'px)'

  // terminal: scenes 1–2
  const termA = fade(t, 0.0, 0.35, 11.5, 11.85)
  $("term").style.opacity = termA
  $("term").style.transform = 'scale(' + (0.97 + 0.03 * ease(span(t, 0, 0.5))) + ')'

  // scene 1
  const s1 = t < 6.0
  $("s1").style.opacity = s1 ? 1 : 0
  type($("p1"), P1, t, 0.6, 2.0); cursor($("k1"), t, 0.4, 2.2)
  $("r1").style.opacity = t >= 2.25 ? 1 : 0
  $("ph1").style.opacity = t >= 2.25 && t < 3.1 ? 0.55 + 0.45 * Math.sin(t * 9) : 0
  const wipe = ease(span(t, 3.1, 4.2))
  $("w1").style.clipPath = 'inset(0 ' + (100 - wipe * 100) + '% 0 0)'
  $("w1").style.opacity = t >= 3.1 ? 1 : 0

  // scene 2
  P2.forEach((p, k) => {
    const s = 6.0 + 1.4 * k, e = s + 1.4
    const on = t >= s && t < (k === P2.length - 1 ? 11.9 : e)
    $("s2-" + k).style.opacity = on ? 1 : 0
    type($("p2-" + k), p, t, s, s + 0.4); cursor($("k2-" + k), t, s, s + 0.5)
    const pop = ease(span(t, s + 0.5, s + 0.8))
    $("r2-" + k).style.opacity = pop
    $("w2-" + k).style.transform = 'translateY(' + (1 - pop) * 24 + 'px)'
  })

  // scene 3: grid
  const gridOut = 1 - span(t, 13.6, 13.95)
  for (let k = 0; k < 6; k++) {
    const g = ease(span(t, 11.8 + k * 0.12, 12.2 + k * 0.12))
    $("g-" + k).style.opacity = g * gridOut
    $("g-" + k).style.transform = 'translateY(' + (1 - g) * 30 + 'px) scale(' + (0.94 + 0.06 * g) + ')'
  }

  // scene 4: end card
  const endA = ease(span(t, 13.9, 14.4))
  $("end").style.opacity = endA
  $("end").style.transform = 'scale(' + (0.96 + 0.04 * endA) + ')'
  type($("cmd"), CMD, t, 14.6, 16.0); cursor($("kc"), t, 14.4, 17.5)
  $("url").style.opacity = ease(span(t, 16.0, 16.4))
  $("meta").style.opacity = ease(span(t, 16.3, 16.7))
}
window.render(0)
</script></body></html>`

mkdirSync(dirname(out), { recursive: true })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--disable-gpu"] })
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: "load" })
await page.evaluate(() => document.fonts.ready)

if (stillsAt) {
  // review mode: a few frames as PNG next to the video
  for (const t of stillsAt) {
    await page.evaluate((t) => (window as unknown as { render: (t: number) => void }).render(t), t)
    await page.screenshot({ path: join(dirname(out), `still-${t}.png`) as `${string}.png` })
    console.log(join(dirname(out), `still-${t}.png`))
  }
  await browser.close()
  process.exit(0)
}

const ff = Bun.spawn(
  ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", out],
  { stdin: "pipe", stderr: "inherit" },
)
const frames = Math.round(DURATION * FPS)
for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => (window as unknown as { render: (t: number) => void }).render(t), f / FPS)
  const shot = await page.screenshot({ type: "png" })
  ff.stdin.write(shot)
  if (f % 60 === 0) process.stdout.write(`\rframe ${f}/${frames}`)
}
await ff.stdin.end()
await ff.exited
await browser.close()
console.log(`\n${out}`)
