/**
 * cells.ts — draws a ChartResult as HTML on a fixed cell grid, the way a
 * terminal does: block elements become exact CSS fills and box-drawing
 * characters CSS strokes, so nothing depends on the font having them.
 * Shared by scripts/screenshots.ts and scripts/promo.ts.
 */
import type { ChartResult } from "../../chart"

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

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
export function cell(ch: string, fg = "#c0caf5", bg?: string): string {
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

/** The chart's rows as `.r` divs of `<i>` cells (style them with cellCss). */
export function rowsHtml(res: ChartResult): string {
  return res.rows
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
}

/** A titled card holding the chart. */
export function cardHtml(res: ChartResult, extraClass = ""): string {
  const title = res.title ? `<div class="t">◇ ${esc(res.title)}</div>` : ""
  return `<div class="card ${extraClass}">${title}${rowsHtml(res)}</div>`
}

/** Cell grid CSS; sizes in px (Menlo's advance is 0.602em). */
export function cellCss(o: { cw: number; ch: number; fs: number; bg: string; border: string }): string {
  return `
  .card{display:inline-block;border:1.5px solid ${o.border};border-radius:10px;padding:${Math.round(o.ch * 0.65)}px ${Math.round(o.cw * 1.9)}px ${Math.round(o.ch * 0.75)}px;background:${o.bg}}
  .t{font:600 ${o.fs + 1}px Menlo,monospace;color:#c0caf5;margin:0 0 ${Math.round(o.ch * 0.4)}px}
  .r{height:${o.ch}px;white-space:nowrap;font:${o.fs}px Menlo,monospace;line-height:${o.ch}px}
  .r i{display:inline-block;width:${o.cw}px;height:${o.ch}px;font-style:normal;text-align:center;vertical-align:top;overflow:hidden}
  .r i[data-b]{font-weight:700}
  .r i.b{font-size:${o.ch}px;line-height:${o.ch}px}`
}
