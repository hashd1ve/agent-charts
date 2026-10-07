#!/usr/bin/env bun
/**
 * demo.ts — renders every example to the terminal with 24-bit ANSI colors.
 *
 *   bun scripts/demo.ts                 all examples at terminal width
 *   bun scripts/demo.ts heat candle     only examples whose name matches
 *   bun scripts/demo.ts --width 60 --light
 *   bun scripts/demo.ts --file spec.json
 */
import { readFileSync } from "node:fs"
import { buildChart, buildFromText, DARK, LIGHT, type ChartResult, type Row } from "../chart"
import { EXAMPLES } from "../examples"
import { strWidth } from "../engine/text"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const widthArg = flag("--width")
const file = flag("--file")
const light = args.includes("--light")
const plain = args.includes("--plain")
const filters = args.filter((a) => !a.startsWith("--"))
const theme = light ? LIGHT : DARK
const width = Number(widthArg ?? Math.min(110, (process.stdout.columns ?? 100) - 4))

const rgb = (hex: string) => {
  const h = hex.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(";")
}

function paint(row: Row): string {
  if (plain) return row.map((r) => r.text).join("")
  return (
    row
      .map((r) => {
        let s = ""
        if (r.bold) s += "\x1b[1m"
        if (r.fg) s += `\x1b[38;2;${rgb(r.fg)}m`
        if (r.bg) s += `\x1b[48;2;${rgb(r.bg)}m`
        return s + r.text + (s ? "\x1b[0m" : "")
      })
      .join("") + (plain ? "" : "\x1b[0m")
  )
}

function card(name: string, res: ChartResult): string {
  const inner = Math.max(width, ...res.rows.map((r) => strWidth(r.map((x) => x.text).join(""))))
  const title = res.title ? ` ◇ ${res.title} ` : ""
  const border = (s: string) => (plain ? s : `\x1b[38;2;${rgb(theme.grid)}m${s}\x1b[0m`)
  const lines = [border(`╭─${title}${"─".repeat(Math.max(0, inner - strWidth(title)))}─╮`)]
  for (const row of res.rows) {
    const w = strWidth(row.map((x) => x.text).join(""))
    lines.push(`${border("│")} ${paint(row)}${" ".repeat(Math.max(0, inner - w))} ${border("│")}`)
  }
  lines.push(border(`╰${"─".repeat(inner + 2)}╯`) + (plain ? `  ${name}` : `  \x1b[2m${name}\x1b[0m`))
  return lines.join("\n")
}

if (file) {
  const text = readFileSync(file, "utf8")
  console.log(card(file, buildFromText(text, "chart", { width, theme })))
} else {
  for (const ex of EXAMPLES) {
    if (filters.length && !filters.some((f) => ex.name.includes(f))) continue
    try {
      console.log(card(ex.name, buildChart(ex.spec, { width, theme })))
    } catch (e) {
      console.log(`✗ ${ex.name}: ${e instanceof Error ? e.stack : e}`)
    }
    console.log()
  }
}
