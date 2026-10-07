/**
 * examples.ts — one spec per chart type (and a few variants). Used by the demo
 * script, the tests and the README.
 */

const months = (from: string, n: number) => {
  const [y, m] = from.split("-").map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    return d.toISOString().slice(0, 7)
  })
}

/** Deterministic pseudo-random numbers (mulberry32) so examples are stable. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r = rng(42)
const normal = () => {
  let u = 0
  let v = 0
  while (u === 0) u = r()
  while (v === 0) v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const unrate = [3.7, 3.8, 3.9, 3.9, 3.8, 4.0, 4.1, 4.2, 4.1, 4.1, 4.2, 4.1, 4.0, 4.1, 4.2, 4.1, 4.2, 4.3]
const cpi = [3.1, 3.2, 3.5, 3.4, 3.3, 3.0, 2.9, 2.5, 2.4, 2.6, 2.7, 2.9, 3.0, 2.8, 2.4, 2.3, 2.4, 2.7]
const core = [3.9, 3.8, 3.8, 3.6, 3.4, 3.3, 3.2, 3.2, 3.3, 3.3, 3.3, 3.2, 3.3, 3.1, 2.8, 2.8, 2.9, 2.9]
const m18 = months("2024-01", 18)

let price = 100
const ohlc = Array.from({ length: 40 }, (_, i) => {
  const o = price
  const c = o * (1 + normal() * 0.02)
  const h = Math.max(o, c) * (1 + r() * 0.012)
  const l = Math.min(o, c) * (1 - r() * 0.012)
  price = c
  const d = new Date(Date.UTC(2026, 7, 3 + i))
  const vol = Math.round(1e6 * (0.6 + r()))
  return [d.toISOString().slice(5, 10), +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2), vol]
})

let btc = 9000
const btcSeries = months("2019-01", 84).map((m) => {
  btc *= Math.exp(0.035 + normal() * 0.18)
  return [m, Math.round(btc)]
})

const days = Array.from({ length: 180 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 3, 10 + i))
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
  return [d.toISOString().slice(0, 10), weekend ? Math.round(r() * 3) : Math.round(r() * 14)]
})

export const EXAMPLES: { name: string; spec: Record<string, unknown> }[] = [
  {
    name: "line",
    spec: { type: "line", title: "US unemployment rate", unit: "%", data: m18.map((m, i) => [m, unrate[i]]) },
  },
  {
    name: "line multi-series + reference",
    spec: {
      type: "line",
      title: "Inflation vs Fed target (YoY %)",
      unit: "%",
      series: [
        { name: "CPI", data: m18.map((m, i) => [m, cpi[i]]) },
        { name: "Core", data: m18.map((m, i) => [m, core[i]]) },
      ],
      refs: [{ y: 2, label: "target" }],
    },
  },
  {
    name: "area log scale",
    spec: { type: "area", title: "BTC monthly close (log)", unit: "$", log: true, data: btcSeries },
  },
  {
    name: "step",
    spec: {
      type: "step",
      title: "ECB deposit rate",
      unit: "%",
      data: [["2023-01", 2], ["2023-03", 3], ["2023-05", 3.25], ["2023-06", 3.5], ["2023-08", 3.75], ["2023-09", 4], ["2024-06", 3.75], ["2024-09", 3.5], ["2024-10", 3.25], ["2024-12", 3], ["2025-02", 2.75], ["2025-03", 2.5], ["2025-04", 2.25], ["2025-06", 2]],
    },
  },
  {
    name: "scatter + trend",
    spec: {
      type: "scatter",
      title: "Spend vs revenue",
      trend: true,
      data: Array.from({ length: 60 }, () => {
        const x = r() * 100
        return [+x.toFixed(1), +(20 + x * 1.8 + normal() * 18).toFixed(1)]
      }),
    },
  },
  {
    name: "area stacked",
    spec: {
      type: "area",
      title: "Revenue mix ($M)",
      stacked: true,
      series: [
        { name: "Cloud", data: m18.map((m, i) => [m, +(20 + i * 1.6 + normal()).toFixed(1)]) },
        { name: "Licenses", data: m18.map((m, i) => [m, +(18 - i * 0.3 + normal() * 0.6).toFixed(1)]) },
        { name: "Services", data: m18.map((m, i) => [m, +(8 + i * 0.2 + normal() * 0.5).toFixed(1)]) },
      ],
    },
  },
  {
    name: "drawdown",
    spec: { type: "drawdown", title: "BTC drawdown from peak", data: btcSeries },
  },
  {
    name: "bar",
    spec: { type: "bar", title: "Units sold", data: { Laptops: 450, Monitors: 320, Keyboards: 210, Mice: 180, Docks: 95 }, sort: true },
  },
  {
    name: "bar diverging",
    spec: { type: "bar", title: "Sector returns YTD", unit: "%", data: { Tech: 18.4, Energy: -6.2, Health: 4.1, Financials: 9.7, Utilities: -2.3, Materials: 1.2 }, sort: true },
  },
  {
    name: "bar stacked",
    spec: {
      type: "bar",
      title: "Cloud spend by service ($k)",
      stacked: true,
      series: [
        { name: "Compute", data: { Q1: 120, Q2: 135, Q3: 150, Q4: 160 } },
        { name: "Storage", data: { Q1: 40, Q2: 44, Q3: 52, Q4: 58 } },
        { name: "Network", data: { Q1: 18, Q2: 22, Q3: 21, Q4: 30 } },
      ],
    },
  },
  {
    name: "column",
    spec: { type: "column", title: "Monthly signups", data: { Jan: 120, Feb: 135, Mar: 160, Apr: 148, May: 190, Jun: 230, Jul: 210, Aug: 260 } },
  },
  {
    name: "column grouped",
    spec: {
      type: "column",
      title: "Revenue by region ($M)",
      series: [
        { name: "2025", data: { NA: 42, EU: 31, APAC: 18, LATAM: 7 } },
        { name: "2026", data: { NA: 48, EU: 33, APAC: 25, LATAM: 9 } },
      ],
    },
  },
  {
    name: "hist",
    spec: { type: "hist", title: "API latency (ms)", unit: "ms", data: Array.from({ length: 400 }, () => +Math.exp(4 + normal() * 0.35).toFixed(1)) },
  },
  {
    name: "heat",
    spec: {
      type: "heat",
      title: "Monthly returns (%)",
      xLabels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      yLabels: ["2023", "2024", "2025"],
      z: [
        [6.2, -2.6, 3.5, 1.5, 0.3, 6.5, 3.1, -1.8, -4.9, -2.2, 8.9, 4.4],
        [1.6, 5.2, 3.1, -4.2, 4.8, 3.5, 1.1, 2.3, 2.0, -1.0, 5.7, -2.5],
        [2.7, -1.4, -5.8, -0.8, 6.2, 5.0, 2.2, 1.9, 3.5, 2.3, null, null],
      ],
    },
  },
  {
    name: "calendar",
    spec: { type: "calendar", title: "Commits per day", data: days },
  },
  {
    name: "candle",
    spec: { type: "candle", title: "ACME daily", unit: "$", data: ohlc },
  },
  {
    name: "pie",
    spec: { type: "pie", title: "Traffic by source", data: { Organic: 4200, Direct: 2600, Referral: 1300, Social: 900, Email: 450 } },
  },
  {
    name: "donut",
    spec: { type: "donut", title: "Portfolio allocation", unit: "$", data: { Equities: 61000, Bonds: 24000, Cash: 9000, Gold: 6000 } },
  },
  {
    name: "gauge",
    spec: { type: "gauge", title: "Cluster", unit: "%", data: { CPU: 72, Memory: 45, Disk: 91 }, thresholds: [60, 85] },
  },
  {
    name: "gauge target",
    spec: { type: "gauge", title: "Q3 targets", data: [{ label: "Revenue ($M)", value: 8.1, max: 10, target: 9 }, { label: "New logos", value: 34, max: 40, target: 30 }] },
  },
  {
    name: "stat",
    spec: {
      type: "stat",
      title: "Markets today",
      data: [
        { label: "S&P 500", value: 5832.9, change: 1.2, spark: [5700, 5720, 5690, 5750, 5780, 5810, 5833] },
        { label: "EUR/USD", value: 1.0842, change: -0.3, spark: [1.09, 1.088, 1.087, 1.086, 1.085, 1.084] },
        { label: "US 10Y", value: 4.21, unit: "%", delta: 0.05, lowerIsBetter: true },
        { label: "BTC", value: 72800, unit: "$", change: 2.4, spark: [69800, 71200, 70100, 72400, 73900, 72800] },
      ],
    },
  },
  {
    name: "dumbbell",
    spec: {
      type: "dumbbell",
      title: "Policy rates 2023 → 2025",
      unit: "%",
      labels: ["2023", "2025"],
      data: [["Fed", 5.5, 4.5], ["ECB", 4.0, 2.0], ["BoE", 5.25, 4.0], ["BoJ", -0.1, 0.5], ["SNB", 1.75, 0]],
    },
  },
  {
    name: "box",
    spec: {
      type: "box",
      title: "Response time by endpoint (ms)",
      unit: "ms",
      data: {
        "/search": Array.from({ length: 120 }, () => +(80 + normal() * 18 + (r() < 0.04 ? 90 : 0)).toFixed(1)),
        "/login": Array.from({ length: 120 }, () => +(45 + normal() * 8).toFixed(1)),
        "/checkout": Array.from({ length: 120 }, () => +(130 + normal() * 30).toFixed(1)),
      },
    },
  },
  {
    name: "waterfall",
    spec: { type: "waterfall", title: "Operating income bridge ($M)", data: [["FY2025", 120], ["Price", 18], ["Volume", 9], ["FX", -7], ["Costs", -14]], total: "FY2026" },
  },
  {
    name: "spark",
    spec: { type: "spark", unit: "%", data: unrate },
  },
  {
    name: "spark watchlist",
    spec: {
      type: "spark",
      title: "Watchlist (30d)",
      unit: "$",
      series: [
        { name: "AAPL", data: Array.from({ length: 30 }, (_, i) => 180 + i * 0.6 + normal() * 2) },
        { name: "MSFT", data: Array.from({ length: 30 }, (_, i) => 410 - i * 0.4 + normal() * 3) },
        { name: "NVDA", data: Array.from({ length: 30 }, (_, i) => 120 + i * 1.1 + normal() * 3) },
      ],
    },
  },
]
