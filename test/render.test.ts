import { afterEach, describe, expect, test } from "bun:test"
import * as OpenTUI from "@opentui/core"
import { MarkdownRenderable, RGBA, SyntaxStyle, createMarkdownCodeBlockRenderer, type CliRenderer } from "@opentui/core"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { createChartBlockRenderer, isClosed, themeFromTokens, toStyledText } from "../render"
import { DARK } from "../engine/theme"

let setup: TestRendererSetup | undefined
afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const CHART = '{"type":"line","title":"Unemployment","unit":"%","data":[["2024-01",3.7],["2024-02",3.9],["2024-03",3.8],["2024-04",4.1]]}'

async function mount(markdown: string, width = 100, height = 40) {
  setup = await createTestRenderer({ width, height })
  const { renderer } = setup
  const render = createChartBlockRenderer(OpenTUI, renderer as CliRenderer)
  const md = new MarkdownRenderable(renderer, {
    content: markdown,
    syntaxStyle: SyntaxStyle.create(),
    renderNode: createMarkdownCodeBlockRenderer({ chart: render, spark: render }),
    width: "100%",
  })
  renderer.root.add(md)
  await setup.flush()
  return { md, frame: () => setup!.captureCharFrame() }
}

describe("markdown integration", () => {
  test("a ```chart block renders as a titled braille card", async () => {
    const { frame } = await mount(`Here you go:\n\n\`\`\`chart\n${CHART}\n\`\`\`\n\nDone.`)
    const f = frame()
    expect(f).toContain("◇ Unemployment")
    expect(f).toMatch(/[⠁-⣿]/)
    expect(f).toContain("last 4.1%")
    expect(f).not.toContain('"type"')
  })

  test("invalid JSON in a closed block shows an error card", async () => {
    const { frame } = await mount('```chart\n{"type":"line","data":[[1,2],\n```\n')
    expect(frame()).toContain("chart: invalid JSON")
  })

  test("an unclosed (still streaming) block shows a placeholder, not an error", async () => {
    const { frame } = await mount('```chart\n{"type":"line","data":[[1,2],')
    const f = frame()
    expect(f).toContain("drawing")
    expect(f).not.toContain("invalid JSON")
  })

  test("the card re-lays out to the real width", async () => {
    const { frame } = await mount(`\`\`\`chart\n${CHART}\n\`\`\`\n`, 120)
    const wide = frame()
    setup!.resize(60, 40)
    await setup!.flush()
    await new Promise((r) => setTimeout(r, 10))
    await setup!.flush()
    const narrow = frame()
    const longest = (s: string) => Math.max(...s.split("\n").map((l) => l.trimEnd().length))
    expect(longest(wide)).toBeGreaterThan(80)
    expect(longest(narrow)).toBeLessThanOrEqual(60)
    // the axis line is intact (not wrapped or cut): ends in the card border
    expect(narrow.split("\n").some((l) => /└[─┬]+/.test(l) && l.trimEnd().endsWith("│"))).toBe(true)
  })

  test("shrinking below the engine's minimum still repaints", async () => {
    const { frame } = await mount(`\`\`\`chart\n${CHART}\n\`\`\`\n`, 120)
    setup!.resize(22, 40)
    await setup!.flush()
    await new Promise((r) => setTimeout(r, 10))
    await setup!.flush()
    const f = frame()
    // repainted at the 20-column floor: the x axis still starts right after the gutter
    expect(f).toMatch(/└[─┬]/)
    expect(f).toMatch(/[⠁-⣿]/)
  })

  test("spark blocks with bare numbers", async () => {
    const { frame } = await mount("```spark\n1 3 2 5 4 6\n```\n")
    expect(frame()).toMatch(/[▁▂▃▄▅▆▇█]{6}/)
  })
})

describe("helpers", () => {
  test("isClosed", () => {
    expect(isClosed({ raw: "```chart\n{}\n```" })).toBe(true)
    expect(isClosed({ raw: "```chart\n{}\n```\n\n" })).toBe(true)
    expect(isClosed({ raw: "```chart\n{}" })).toBe(false)
    expect(isClosed({ raw: "````chart\n{}\n```" })).toBe(false)
    expect(isClosed({ raw: "~~~chart\n{}\n~~~" })).toBe(true)
  })

  test("themeFromTokens maps OpenCode tokens and survives junk", () => {
    const c = (hex: string) => RGBA.fromHex(hex)
    const t = themeFromTokens(
      {
        categorical: [{ 200: c("#ff0000") }, { 200: c("#00ff00") }, { 200: c("#0000ff") }],
        text: { base: c("#eeeeee"), muted: c("#888888"), feedback: { success: { base: c("#11aa11") }, error: { base: c("#aa1111") } } },
        background: { base: c("#101010") },
      },
      "dark",
    )
    expect(t.palette).toEqual(["#ff0000", "#00ff00", "#0000ff"])
    expect(t.text).toBe("#eeeeee")
    expect(t.up).toBe("#11aa11")
    expect(t.down).toBe("#aa1111")
    expect(t.background).toBe("#101010")
    expect(themeFromTokens(null, "dark")).toEqual(DARK)
    expect(themeFromTokens({ categorical: "nope", text: 3 }, "light").mode).toBe("light")
  })

  test("toStyledText keeps rows and colors", () => {
    const st = toStyledText(OpenTUI, [[{ text: "ab", fg: "#ff0000" }], [{ text: "c", bg: "#00ff00", bold: true }]])
    expect(st.chunks.map((c) => c.text).join("")).toBe("ab\nc")
    expect(st.chunks[0].fg?.toInts().slice(0, 3)).toEqual([255, 0, 0])
  })
})
