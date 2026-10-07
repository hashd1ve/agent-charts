import { describe, expect, test } from "bun:test"
import { buildChart, buildFromText, DARK, LIGHT, parseBlock, specFromText } from "../chart"
import { EXAMPLES } from "../examples"
import { fmtValue, tickFormatter, withUnit } from "../engine/format"
import { rowWidth } from "../engine/grid"
import { parseRelaxedJSON } from "../engine/json"
import { logDomain, niceDomain } from "../engine/scale"
import { parseDate, readSeries, resolveType, toPairs, toXY } from "../engine/spec"
import { strWidth, truncate } from "../engine/text"
import type { ChartResult } from "../engine/types"

const text = (res: ChartResult) => res.rows.map((r) => r.map((x) => x.text).join(""))

describe("every example", () => {
  for (const ex of EXAMPLES) {
    for (const width of [30, 48, 80, 120, 200]) {
      test(`${ex.name} @ ${width} cols fits`, () => {
        for (const theme of [DARK, LIGHT]) {
          const res = buildChart(ex.spec, { width, theme })
          expect(res.rows.length).toBeGreaterThan(0)
          for (const row of res.rows) expect(rowWidth(row)).toBeLessThanOrEqual(width)
          for (const row of res.rows) for (const run of row) {
            if (run.fg) expect(run.fg).toMatch(/^#[0-9a-f]{6}$/i)
            if (run.bg) expect(run.bg).toMatch(/^#[0-9a-f]{6}$/i)
          }
        }
      })
    }
  }

  test("titles come through", () => {
    for (const ex of EXAMPLES) {
      const res = buildChart(ex.spec, { width: 80 })
      if (typeof ex.spec.title === "string") expect(res.title).toBe(ex.spec.title)
    }
  })
})

describe("relaxed JSON", () => {
  test("comments, trailing commas, single quotes, bare keys", () => {
    const v = parseRelaxedJSON(`{
      // a comment
      type: 'line', /* block */
      "data": [[1, 2], [2, 3],],
      nan: NaN,
    }`) as Record<string, unknown>
    expect(v).toEqual({ type: "line", data: [[1, 2], [2, 3]], nan: null })
  })

  test("reports position on errors", () => {
    expect(() => parseRelaxedJSON('{"a": [1, 2}')).toThrow(/line 1/)
  })
})

describe("data shapes", () => {
  test("pairs, numbers, maps, objects", () => {
    expect(toPairs([["a", 1], ["b", null]])).toEqual([["a", 1], ["b", null]])
    expect(toPairs([4, null, "5"])).toEqual([[1, 4], [2, null], [3, 5]])
    expect(toPairs({ x: 1, y: "2.5" })).toEqual([["x", 1], ["y", 2.5]])
    expect(toPairs([{ date: "2024-01", value: 3 }, { date: "2024-02", close: 4 }])).toEqual([["2024-01", 3], ["2024-02", 4]])
    expect(toPairs([1, 2], ["a", "b"])).toEqual([["a", 1], ["b", 2]])
  })

  test("series maps and Chart.js datasets", () => {
    expect(readSeries({ data: { CPI: [1, 2], Core: [3, 4] } }).map((s) => s.name)).toEqual(["CPI", "Core"])
    const cj = readSeries({ type: "bar", data: { labels: ["a", "b"], datasets: [{ label: "x", data: [1, 2] }] } })
    expect(cj[0]).toEqual({ name: "x", color: undefined, pairs: [["a", 1], ["b", 2]] })
  })

  test("dates", () => {
    expect(parseDate("2024")).toBeUndefined() // plain years are numbers
    expect(parseDate("2024-03")).toBe(Date.UTC(2024, 2, 1))
    expect(parseDate("2024-Q2")).toBe(Date.UTC(2024, 3, 1))
    expect(parseDate("2024-03-05")).toBe(Date.UTC(2024, 2, 5))
    expect(parseDate("2024-13")).toBeUndefined()
    expect(parseDate("Jan")).toBeUndefined()
  })

  test("series of different lengths share the x axis", () => {
    const { series, kind } = toXY(readSeries({ series: [{ data: [["2024-01", 1], ["2024-06", 2]] }, { data: [["2024-03", 5]] }] }))
    expect(kind).toBe("time")
    expect(series[1].points[0].x).toBe(Date.UTC(2024, 2, 1))
  })

  test("type aliases and inference", () => {
    expect(resolveType({ type: "Heat-Map" })).toBe("heat")
    expect(resolveType({ type: "candlestick" })).toBe("candle")
    expect(resolveType({ data: { a: 1 } })).toBe("bar")
    expect(resolveType({ data: [[1, 2, 3, 4, 5]] })).toBe("candle")
    expect(resolveType({ data: [[3, 1], [1, 2], [2, 5]] })).toBe("scatter")
    expect(resolveType({ data: [[1, 1], [2, 2]] })).toBe("line")
    expect(resolveType({ value: 3 })).toBe("gauge")
    expect(() => resolveType({ type: "radar" })).toThrow(/unknown type/)
  })
})

describe("plain-text blocks", () => {
  test("bare numbers", () => {
    expect(specFromText("1 2 3", "spark")).toEqual({ type: "spark", data: [1, 2, 3] })
    expect(specFromText("1, 2, 3").type).toBe("line")
  })

  test("label: value lines → bar", () => {
    const s = specFromText("Laptops: 450\nMonitors: 320")
    expect(s.type).toBe("bar")
    expect(s.data).toEqual([["Laptops", 450], ["Monitors", 320]])
  })

  test("CSV with header → one series per column", () => {
    const s = specFromText("month,cpi,core\n2024-01,3.1,3.9\n2024-02,3.2,3.8")
    expect(s.type).toBe("line")
    expect(s.series.map((x: { name: string }) => x.name)).toEqual(["cpi", "core"])
  })

  test("spark blocks default to spark type", () => {
    expect(parseBlock('{"data":[1,2,3]}', "spark").type).toBe("spark")
  })

  test("garbage is rejected with a hint", () => {
    expect(() => buildFromText("hello world", "chart")).toThrow(/JSON/)
  })
})

describe("formatting", () => {
  test("values", () => {
    expect(fmtValue(1234567)).toBe("1.23M")
    expect(fmtValue(12345)).toBe("12,345")
    expect(fmtValue(4.1234)).toBe("4.12")
    expect(fmtValue(0.012345)).toBe("0.0123")
    expect(fmtValue(-0.0001)).toBe("-0.0001")
    expect(fmtValue(5, "%", { sign: true })).toBe("+5%")
  })

  test("currency units are prefixes", () => {
    expect(withUnit("12", "$")).toBe("$12")
    expect(withUnit("-12", "€")).toBe("-€12")
    expect(withUnit("+3", "$")).toBe("+$3")
    expect(withUnit("12", "ms")).toBe("12ms")
  })

  test("ticks share decimals and suffix", () => {
    const f = tickFormatter([0, 0.5, 1], 0.5)
    expect([0, 0.5, 1].map(f)).toEqual(["0.0", "0.5", "1.0"])
    const g = tickFormatter([0, 25000, 50000], 25000)
    expect([0, 25000, 50000].map(g)).toEqual(["0k", "25k", "50k"])
  })

  test("display width", () => {
    expect(strWidth("日本")).toBe(4)
    expect(truncate("abcdef", 4)).toBe("abc…")
  })
})

describe("scales", () => {
  test("nice domains cover the data with round ticks", () => {
    const d = niceDomain(3.7, 4.3, 5)
    expect(d.lo).toBeLessThanOrEqual(3.7)
    expect(d.hi).toBeGreaterThanOrEqual(4.3)
    for (const t of d.ticks) expect(Math.abs(t / d.step - Math.round(t / d.step))).toBeLessThan(1e-9)
  })

  test("pinned ends and zero", () => {
    expect(niceDomain(5, 9, 4, { zero: true }).lo).toBe(0)
    expect(niceDomain(5, 9, 4, { fixedLo: 4 }).lo).toBe(4)
    expect(niceDomain(2, 2, 4).hi).toBeGreaterThan(2)
  })

  test("log ticks are powers of ten (and friends)", () => {
    const d = logDomain(800, 1_300_000)
    expect(d.log).toBe(true)
    expect(d.ticks).toContain(10_000)
    expect(d.ticks.every((t) => t >= d.lo && t <= d.hi)).toBe(true)
  })
})

describe("chart behaviour", () => {
  test("scatter places points by x value, not index", () => {
    const res = buildChart({ type: "scatter", data: [[0, 0], [100, 0], [1, 0]], stats: false }, { width: 60 })
    const rows = text(res)
    const plot = rows.find((r) => /[⠀-⣿]/.test(r))!
    // the [100,0] point must reach the right edge
    expect(rows.some((r) => /[⠀-⣿]\s*$/.test(r) && r.length > 50)).toBe(true)
    expect(plot).toBeDefined()
  })

  test("null values break the line", () => {
    const withGap = text(buildChart({ data: [1, 2, null, null, null, 2, 1], stats: false, height: 4 }, { width: 40 }))
    const without = text(buildChart({ data: [1, 2, 2, 2, 2, 2, 1], stats: false, height: 4 }, { width: 40 }))
    expect(withGap.join("\n")).not.toBe(without.join("\n"))
  })

  test("line stats row", () => {
    const rows = text(buildChart({ unit: "%", data: [["2024-01", 4], ["2024-02", 4.5]] }, { width: 60 }))
    expect(rows.at(-1)).toContain("last 4.5%")
    expect(rows.at(-1)).toContain("chg +0.5")
  })

  test("multi-series legend shows last values", () => {
    const rows = text(buildChart({ series: [{ name: "A", data: [1, 2] }, { name: "B", data: [3, 4] }] }, { width: 60 }))
    expect(rows[0]).toContain("● A 2")
    expect(rows[0]).toContain("● B 4")
  })

  test("negative bars draw left of the zero line", () => {
    const rows = text(buildChart({ type: "bar", data: { up: 5, down: -5 } }, { width: 40 }))
    const up = rows.find((r) => r.startsWith("up"))!
    const down = rows.find((r) => r.startsWith("down"))!
    expect(up.indexOf("█")).toBeGreaterThan(down.indexOf("█"))
  })

  test("waterfall appends a total", () => {
    const rows = text(buildChart({ type: "waterfall", data: [["a", 10], ["b", 5], ["c", -3]] }, { width: 50 }))
    expect(rows.at(-1)).toMatch(/^Total.*12$/)
  })

  test("candles merge when they don't fit", () => {
    const data = Array.from({ length: 300 }, (_, i) => [`d${i}`, 10, 11, 9, 10.5])
    const rows = text(buildChart({ type: "candle", data }, { width: 60 }))
    expect(rows.join("\n")).toContain("1 candle = ")
  })

  test("gauge picks a sensible max", () => {
    const rows = text(buildChart({ type: "gauge", data: { a: 0.5 } }, { width: 40 }))
    expect(rows[0]).toContain("0.5 / 1")
  })

  test("heat long format pivots", () => {
    const res = buildChart({ type: "heat", data: [["x1", "y1", 1], ["x2", "y1", 2], ["x1", "y2", 3]] }, { width: 60 })
    const rows = text(res)
    expect(rows[0]).toContain("x1")
    expect(rows.join("\n")).toContain("·") // the missing x2/y2 cell
  })

  test("spark resamples long series to the width", () => {
    const res = buildChart({ type: "spark", data: Array.from({ length: 500 }, (_, i) => Math.sin(i / 20)) }, { width: 60 })
    expect(rowWidth(res.rows[0])).toBeLessThanOrEqual(60)
  })

  test("pie lumps small slices into Other", () => {
    const data = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`s${i}`, 12 - i]))
    expect(text(buildChart({ type: "pie", data }, { width: 80 })).join("\n")).toContain("Other")
  })

  test("custom colors override the palette", () => {
    const res = buildChart({ type: "bar", data: { a: 1 }, colors: ["#123456"] }, { width: 40 })
    expect(res.rows[0].some((r) => r.fg === "#123456")).toBe(true)
  })

  test("helpful errors", () => {
    expect(() => buildChart({ type: "line" })).toThrow(/no data/)
    expect(() => buildChart({ type: "heat", data: 3 })).toThrow(/heat/)
    expect(() => buildChart({ type: "candle", data: [[1, 2]] })).toThrow(/candle/)
  })
})

test("line snapshot", () => {
  const res = buildChart({ type: "line", title: "t", unit: "%", data: [["2024-01", 1], ["2024-02", 3], ["2024-03", 2], ["2024-04", 4]] }, { width: 48 })
  expect(text(res).join("\n")).toMatchSnapshot()
})

test("bar snapshot", () => {
  const res = buildChart({ type: "bar", data: { alpha: 10, beta: 7.5, gamma: 2 } }, { width: 40 })
  expect(text(res).join("\n")).toMatchSnapshot()
})

describe("review regressions", () => {
  const rows = (spec: Record<string, unknown>, width = 40) => text(buildChart(spec, { width }))

  test("extreme magnitudes don't hang", () => {
    for (const spec of [
      { type: "line", data: [1e16, 1e16 + 2] },
      { type: "line", data: [["a", -1.5e308], ["b", 1.5e308]] },
      { type: "box", data: [1e16, 1e16 + 2, 1e16 + 4] },
      { type: "scatter", data: [[1e16, 1], [1e16 + 2, 2]] },
      { type: "hist", data: [1e16, 1e16 + 2, 1e16 + 4] },
    ]) {
      expect(rows(spec).length).toBeGreaterThan(0)
    }
    expect(niceDomain(1e16, 1e16 + 2, 5).ticks.length).toBeLessThanOrEqual(2)
  })

  test("plain text keeps thousands separators and label: value lines", () => {
    expect(specFromText("Revenue: 1,200\nCosts: 3,400").data).toEqual([["Revenue", 1200], ["Costs", 3400]])
    expect(specFromText("1,234 2,345 3,456").data).toEqual([1234, 2345, 3456])
    expect(specFromText('name,value\nA,"1,234"\nB,"2,000"').data).toEqual([["A", 1234], ["B", 2000]])
    expect(specFromText("100,200,300").data).toEqual([100, 200, 300])
    expect(specFromText("Revenue: $1,200\nCosts: $3,400").data).toEqual([["Revenue", 1200], ["Costs", 3400]])
    expect(specFromText("a;1,5\nb;2,25").data).toEqual([["a", 1.5], ["b", 2.25]])
    expect(specFromText("2024-01-01T10:00,3\n2024-01-01T11:00,4").type).toBe("line")
  })

  test("column with yMin keeps bars inside the plot", () => {
    const r = rows({ type: "column", data: { A: 60, B: 80, C: 100 }, yMin: 50 })
    expect(r.at(-1)).not.toContain("█")
    expect(r.join("\n")).toContain("█")
  })

  test("waterfall accepts bare numbers with labels and rejects empty data", () => {
    const r = rows({ type: "waterfall", data: [100, 20, -10], labels: ["Start", "Up", "Down"] })
    expect(r.at(-1)).toMatch(/^Total.*110$/)
    expect(() => buildChart({ type: "waterfall", data: [] })).toThrow(/waterfall/)
  })

  test("parallel columns inside data are one series", () => {
    const r = rows({ type: "line", data: { x: ["2024-01", "2024-02", "2024-03"], y: [1, 2, 3] } }, 60)
    expect(r.join("\n")).toContain("2024-01")
    expect(r[0]).not.toContain("●")
    const b = rows({ type: "bar", data: { labels: ["A", "B"], values: [1, 2] } })
    expect(b.length).toBe(2)
  })

  test("gauge labels shrink and value text never overwrites them", () => {
    const r = rows({ type: "gauge", data: { "Monthly recurring revenue": 1234567, "Annual run rate": 2345678 } }, 30)
    for (const line of r) expect(line).toMatch(/[█▏▎▍▌▋▊▉]/)
    const cjk = buildChart({ type: "gauge", data: { 日本語のラベル: 50, 中文标签: 70 } }, { width: 20 })
    for (const row of cjk.rows) expect(rowWidth(row)).toBeLessThanOrEqual(20)
  })

  test("newest-first candles and sparks are put in date order", () => {
    const r = rows({ type: "candle", data: [["2026-01-03", 11, 13, 10, 12.5], ["2026-01-02", 12, 12.5, 10.5, 12], ["2026-01-01", 11, 12.2, 10.8, 11]] }, 60)
    expect(r.at(-1)).toContain("C 12.5")
    expect(r.at(-1)).toContain("+4.17%")
    const s = rows({ type: "spark", data: [["2026-01-03", 3], ["2026-01-02", 2], ["2026-01-01", 1]] }, 60)
    expect(s[0]).toContain("▲")
  })

  test("tiny and mixed magnitudes stay readable", () => {
    expect(fmtValue(1e-9)).toBe("1e-9")
    expect(fmtValue(1.234e-7)).toBe("1.23e-7")
    const h = rows({ type: "heat", z: [[12345, 500], [2000000, 7]] }, 60).join("\n")
    expect(h).toContain("12.3k")
    expect(h).toContain("2M")
    expect(h).not.toMatch(/0\.0+\d*M/)
  })

  test("grouped pie slices never share a color", () => {
    const data = { a: 100, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 90, j: 50, k: 40, l: 30 }
    const res = buildChart({ type: "pie", data }, { width: 80 })
    const dots = res.rows.flatMap((r) => r.filter((x) => x.text === "● ").map((x) => x.fg))
    expect(new Set(dots).size).toBe(dots.length)
  })

  test("narrow widths keep content, not just clipped rows", () => {
    const wl = buildChart(EXAMPLES.find((e) => e.name === "spark watchlist")!.spec, { width: 30 })
    for (const row of wl.rows) expect(rowWidth(row)).toBeLessThanOrEqual(30)
    expect(text(wl).join("\n")).toMatch(/[▁▂▃▄▅▆▇█]{4}/)
    const pie = buildChart({ type: "pie", data: { "A rather long slice name": 3, "Another long one": 2 } }, { width: 30 })
    expect(text(pie).join("\n")).toContain("%")
  })
})

test("crossing series never paint dots in the other series' color", async () => {
  const { BrailleCanvas, LAYER } = await import("../engine/canvas")
  const { CellGrid } = await import("../engine/grid")
  const c = new BrailleCanvas(1, 1)
  // series A: a full column of dots; series B (drawn last): a single dot
  for (let y = 0; y < 4; y++) c.dot(0, y, "#aaaaaa", LAYER.line)
  c.dot(1, 0, "#bbbbbb", LAYER.line)
  const g = new CellGrid(1, 1)
  c.blit(g, 0, 0)
  const cell = g.get(0, 0)!
  expect(cell.fg).toBe("#aaaaaa")
  // A's 4 dots (bits 0x01|0x02|0x04|0x40) and not B's (0x08)
  expect(cell.ch.charCodeAt(0) - 0x2800).toBe(0x47)
})

describe("v2.2 types", () => {
  const rows = (spec: Record<string, unknown>, width = 80) => text(buildChart(spec, { width }))

  test("stacked area: the top band ends at the sum of the series", () => {
    const res = buildChart({ type: "area", stacked: true, stats: false, series: [{ name: "a", data: [["2025-01", 10], ["2025-02", 10]] }, { name: "b", data: [["2025-01", 5], ["2025-02", 5]] }] }, { width: 60 })
    const r = text(res)
    expect(r[0]).toContain("● a 10")
    // the axis tops out at a round number covering 15
    expect(r.some((l) => /^\s*(15|16|20)\s/.test(l))).toBe(true)
  })

  test("percent stacked area runs 0–100%", () => {
    const r = rows({ type: "area", percent: true, series: [{ name: "a", data: [1, 3] }, { name: "b", data: [3, 1] }] })
    expect(r.join("\n")).toContain("100%")
  })

  test("drawdown reports the worst fall and its peak", () => {
    const r = rows({ type: "drawdown", data: [["2024-01", 100], ["2024-02", 120], ["2024-03", 60], ["2024-04", 90], ["2024-05", 130]] })
    const footer = r.at(-1)!
    expect(footer).toContain("max dd -50% 2024-03")
    expect(footer).toContain("from peak 2024-02")
    expect(footer).toContain("now at peak")
  })

  test("stat tiles keep the given precision and color the change", () => {
    const res = buildChart({ type: "stat", data: [{ label: "FX", value: 1.0842, change: -0.3 }, { label: "Cost", value: 10, change: 5, lowerIsBetter: true }] }, { width: 60 })
    const r = text(res).join("\n")
    expect(r).toContain("1.0842")
    expect(r).toContain("▼ -0.3%")
    const runs = res.rows.flat()
    expect(runs.find((x) => x.text === "+5%")?.fg).toBe(DARK.down) // up is bad here
    expect(runs.find((x) => x.text === "-0.3%")?.fg).toBe(DARK.down)
  })

  test("stat tiles fit the width, wrapping into rows", () => {
    const res = buildChart({ type: "stat", data: { a: 1, b: 2, c: 3, d: 4, e: 5 } }, { width: 40 })
    for (const row of res.rows) expect(rowWidth(row)).toBeLessThanOrEqual(40)
    expect(res.rows.length % 5).toBe(0)
  })

  test("dumbbell: both values, the change colored, from rows or two series", () => {
    const res = buildChart({ type: "dumbbell", data: [["a", 1, 3], ["b", 4, 2]] }, { width: 60 })
    const r = text(res)
    expect(r.find((l) => l.startsWith("a"))).toContain("1 → 3")
    const bar = res.rows.find((row) => row[0]?.text.startsWith("b"))!.find((x) => x.text.includes("━"))
    expect(bar?.fg).toBe(DARK.down)
    const two = rows({ type: "dumbbell", series: [{ name: "2023", data: { x: 1 } }, { name: "2025", data: { x: 2 } }] })
    expect(two[0]).toContain("● 2023")
  })
})
