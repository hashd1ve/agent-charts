# opencode-charts

Inline charts for the [OpenCode](https://opencode.ai) v2 TUI. Ask your agent for a chart and it draws it right in the conversation, using braille dots, eighth blocks and half-block pixels on the terminal grid. There are no images, no external tools and no runtime dependencies, so it works over SSH too.

The model writes a JSON spec in a fenced ` ```chart ` block:

````
```chart
{"type":"line","title":"Inflation vs Fed target (YoY %)","unit":"%",
 "series":[{"name":"CPI","data":[["2024-01",3.1],["2024-02",3.2],…]},{"name":"Core","data":[…]}],
 "refs":[{"y":2,"label":"target"}]}
```
````

and the plugin paints it inside a card that follows your OpenCode theme (dark or light):

```
╭─ ◇ Inflation vs Fed target (YoY %) ──────────────────────────────────────╮
│ ● CPI 2.7%  ● Core 2.9%  ┄ target 2%                                     │
│ 4.0% ┤⠤⣀⣀⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁ │
│      │   ⠉⠉⠉⠉⠉⠒⠤⣀                                                        │
│ 3.5% ┤⠄⠄⠄⠄⠄⠄⠄⡠⢄⣀⡀⠉⠒⠤⣀⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄ │
│      │    ⢀⠔⠊   ⠈⠉⠑⠒⠢⠭⡑⠒⠢⠤⢄⣀⡀     ⣀⣀⠤⠤⠤⠤⠤⠤⠤⠤⠤⢄⣀⡀ ⢀⣀⡠⠤⣀                   │
│      │⠤⠒⠒⠉⠁           ⠈⠑⢄⡀  ⠈⠉⠉⠉⠉⠉             ⠈⠉⠁    ⠉⠒⠤⣀               │
│ 3.0% ┤⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠈⠉⠑⠒⠢⡀⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⠁⣀⠤⠒⠒⠊⠉⠉⠑⠢⠤⣀⠁⠑⠤⣀⣀⣀⣀⣀⠤⠤⠒⠒⠒⠒⠒ │
│      │                        ⠈⠢⡀       ⢀⡠⠤⠔⠒⠉           ⠑⢄           ⡠⠔ │
│ 2.5% ┤⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠈⠒⠤⠤⣀⡠⠔⠊⠁⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂⠈⠢⣀⠂⠂⠂⠂⠂⠂⣀⠔⠊⠂⠂ │
│      │                                                       ⠉⠉⠒⠒⠉⠉      │
│ 2.0% ┤⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀⡀⢀⣀⡀⣀ │
│      └┬──────────────┬──────────────┬───────────────┬──────────────────┬ │
│       2024-01     2024-05        2024-09         2025-01         2025-06 │
╰──────────────────────────────────────────────────────────────────────────╯
```

(The samples here are plain text. In the TUI every series, bar, cell and candle is colored from your theme.)

## Install

1. Clone the repo and copy the plugin into your OpenCode config:

   ```sh
   git clone https://github.com/hashd1ve/opencode-charts && cd opencode-charts
   bun scripts/install.ts            # → ~/.config/opencode/plugins/charts (backs up any previous copy)
   ```

2. List it in `~/.config/opencode/cli.json`:

   ```json
   { "plugins": ["~/.config/opencode/plugins/charts"] }
   ```

3. Restart OpenCode. Running TUIs hot-reload the plugin when its files change.

There's nothing to `npm install`. At runtime the plugin only uses modules that the OpenCode host already provides.

## Chart types

| type | data | good for |
|---|---|---|
| `line` | `"data":[["2024-01",4.1],…]` or `"series":[{"name","data"},…]` | time series, trends, comparisons |
| `area` | like `line`, filled with a dithered gradient | one series with a clear shape |
| `step` | like `line`, value holds until the next point | policy rates, thresholds, tiers |
| `scatter` | `"data":[[x,y],…]` | correlation (`"trend":true` adds a regression line and r²) |
| `bar` | `"data":{"A":450,"B":320}` | ranking and comparison; negatives diverge from zero |
| `column` | same as `bar` | monthly or quarterly values, with value labels on top |
| `hist` | `"data":[raw values]`, `"bins"` | distributions (footer shows n, mean, median, σ) |
| `heat` | `"xLabels","yLabels","z":[[row],…]` or `"data":[[x,y,v],…]` | matrices; mixed signs use a diverging scale (monthly returns) |
| `calendar` | `"data":[["2026-03-01",v],…]` | daily activity, GitHub-style |
| `candle` | `"data":[[date,o,h,l,c,volume?],…]` | OHLC with an optional volume pane |
| `pie` / `donut` | `"data":{"A":60,"B":40}` | composition (more than 8 slices collapse into "Other") |
| `gauge` | `"data":{"CPU":72}`, `"max"`, `"thresholds"`, `"target"` | KPIs, progress, bullet charts |
| `box` | `"data":{"group":[values],…}` or precomputed quartiles | comparing distributions |
| `waterfall` | `"data":[["Start",100],["Price",12],["Cost",-5]]`, `"total"` | bridges (P&L, budget changes) |
| `spark` | `"data":[…]`; with `"series"` it becomes a watchlist | one-liners, dashboards |

Multi-series `bar` and `column` charts are grouped by default. Add `"stacked":true` to stack them, or `"percent":true` for 100% bars (`bar` only). `"sort":true` orders bars by value, and `"highlight":"A"` dims every other bar.

**Common options:** `title`, `subtitle`, `unit` (`"%"`, `"ms"`…; currency symbols such as `"$"` or `"€"` become prefixes), `height` (rows), `width`, `colors` (`["#hex",…]`), `note`/`source` (a footer line), `legend:false`, `stats:false`.

**Line family:** `log:true`, `zero:true`, `yMin`/`yMax`, `refs:[{"y":2,"label":"target"}]`, `trend:true`. Labels in `YYYY`, `YYYY-MM`, `YYYY-MM-DD` or `YYYY-Qn` form go on a real time axis, so uneven spacing is honest. Series of different lengths line up, and `null` leaves a gap.

### More examples

```
╭─ ◇ Sector returns YTD ───────────────────────────────────────────────────╮
│ Tech                    ▕█████████████████████████████████████████ 18.4% │
│ Financials              ▕█████████████████████▌                     9.7% │
│ Health                  ▕█████████                                  4.1% │
│ Materials               ▕██▌                                        1.2% │
│ Utilities          ▕████▉                                          -2.3% │
│ Energy     █████████████▉                                          -6.2% │
╰──────────────────────────────────────────────────────────────────────────╯
╭─ ◇ ACME daily ───────────────────────────────────────────────────────────╮
│ $110 ┤· · · · · · · · · · ┃ ╿╵· ·┃┃ ┃ ╷╽·╽·┃┃ ╽ ╷ · ·╷╷ · · · · · · · ·  │
│      │            ╻ ╻     ┃      ││ ┃ ┃╹   ╵╵ ╿ ┃  ╷ ┃┃                  │
│      │            ┃ ┃   ╻ ┃                     ┃╻ ╽ ┃┃ ╽╻ ╻ ╻           │
│ $105 ┤· · · · · ┃ ╿ ╹┃·╽┃ ╵ · · · · · · · · · · ·╹·╿· ╵ ╿╹·╵·┃╽ ╽ ╻ · ·  │
│      │         ╽┃    ╵ ┃┃                                    ╵┃ ┃ ┃╽     │
│ $100 ┤╽ · ╽╽·╽·┃╵ · · ·╿╿ · · · · · · · · · · · · · · · · · · │ ╵ ·┃·╽·╽ │
│  vol │            ▂ ▄  ▇  ▂    ▂  ▆ ▄  ▄ ▃    ▇    █    ▁     ▅ ▆ ▅    █ │
│      │█ █ ██ █ ██ █ ██ ██ █ ██ █ ██ █ ██ █ ██ █ ██ █ ██ ██ █ ██ █ ██ █ █ │
│      └┬─────────┬─────────┬─────────┬─────────┬─────────┬──────────────┬ │
│       08-03   08-09     08-15     08-21     08-27     09-02        09-11 │
│ O $100.3  H $101.1  L $95.6  C $96.48  -3.77%                            │
╰──────────────────────────────────────────────────────────────────────────╯
╭─ ◇ Portfolio allocation ─────────────────────╮
│    ▄▄██████▄▄                                │
│  ▄████████████▄                              │
│ ▄██▀▀      ▀███▄   ● Equities   61%  $61,000 │
│ ████  $100k ████   ● Bonds      24%  $24,000 │
│ ████        ████   ● Cash      9.0%   $9,000 │
│ ▀███▄      ▄███▀   ● Gold      6.0%   $6,000 │
│  ▀█▀██████████▀                              │
│    ▀▀██████▀▀                                │
╰──────────────────────────────────────────────╯
╭─ ◇ Q3 targets ───────────────────────────────────────────────────────────╮
│ Revenue ($M) ████████████████████████████████████▌   ┃     8.1 / 10  81% │
│ New logos    █████████████████████████████████┃████▎        34 / 40  85% │
╰──────────────────────────────────────────────────────────────────────────╯
╭─ ◇ Operating income bridge ($M) ─────────────────────────────────────────╮
│ FY2025 █████████████████████████████████████████████████▊            120 │
│ Price                                                   ▕███████▎    +18 │
│ Volume                                                          ▐███  +9 │
│ FX                                                               ███  -7 │
│ Costs                                                      ▐█████▏   -14 │
│ FY2026 ████████████████████████████████████████████████████▎         126 │
╰──────────────────────────────────────────────────────────────────────────╯
╭─ ◇ Watchlist (30d) ──────────────────────────────────────────────────────╮
│ AAPL  ▁▃▃▃▂▂▄▄▄▅▄▄▃▅▅▆▆▅▆▆▇▆▇▆▇▇████  $196.7  ▲ +10.8%                   │
│ MSFT  █▆▇▆▅▅▆▆▇▅▅▆▄▃▄▅▃▄▅▁▄▄▁▃▄▂▃▃▅▃  $399.6  ▼ -3.49%                   │
│ NVDA  ▂▁▃▃▃▄▄▄▄▄▄▅▄▅▅▅▅▆▆▅▆▆▆▇▇▇█▇▇▇  $150.5  ▲ +25.7%                   │
╰──────────────────────────────────────────────────────────────────────────╯
```

Run `bun scripts/demo.ts` to see every type in full color in your terminal.

### Forgiving input

Models don't always write tidy JSON, so the parser accepts a lot:

- JSON with comments, trailing commas, single quotes, bare keys, or `NaN`
- data as `[label, value]` pairs, bare numbers, `{label: value}` maps, objects with common keys (`date`/`value`, `x`/`y`, `close`…), `{"CPI":[…],"Core":[…]}` series maps, or Chart.js `{"labels","datasets"}`
- numeric strings such as `"4.1"`, `"1,234"` or `"12%"`
- type aliases: `heatmap`, `candlestick`, `ohlc`, `histogram`, `donut`, `meter`, `progress`, `bridge`, `sparkline`…
- non-JSON blocks: bare numbers (`4.1 4.2 4.0`), `label: value` lines, or CSV/TSV with a header row (one series per column)

While a block is still streaming in, the card shows a quiet `◇ chart · drawing…` placeholder instead of flashing a parse error. Only a finished block with a broken spec gets a red error card.

## Teaching the model

The plugin's server half (`index.ts`) appends a short cheat sheet (`prompt.ts`) to the system prompt. Every session therefore knows the chart types and data shapes, and you don't have to edit `AGENTS.md`. Turn it off with the plugin option `{ "prompt": false }`, and paste `CHART_PROMPT` from `prompt.ts` into your own instructions instead if you prefer.

## How it works

- `engine/` is the pure chart engine: spec in, rows of styled runs out. Each chart draws into a `CellGrid`, so it can never exceed the width it was given. The drawing surfaces are a `BrailleCanvas` (2×4 dots per cell, with layered colors so lines win over fills and grid), a `PixelCanvas` (half-block pixels with full color per pixel, used for pie charts) and fractional bars made of eighth blocks. Where two stacked segments meet inside one cell, the cell uses the lower segment as foreground and the upper one as background, so there's no visible gap.
- `render.ts` bridges to OpenTUI. Each chart becomes a single `TextRenderable` with `StyledText` content (foreground and background per run) inside a rounded card. The card measures its real width, which changes when the sidebar opens or the terminal is resized, and redraws the chart to fit. Narrow charts get a snug card.
- `tui.ts` is the TUI plugin entry. It registers the `chart` and `spark` languages and maps OpenCode's resolved theme tokens (`categorical`, `text`, `feedback`, `background`) onto the chart palette. It imports `@opentui/core` itself and passes the classes on to `render.ts`, because the host only swaps that import for its own runtime instance in the entry file. Renderables from a second copy of the library can't paint into the host's buffers.
- `index.ts` is the server plugin entry (prompt injection). It has no runtime imports.

Plugin options (`cli.json`): `maxWidth` (default 140), `languages` (default `["chart","spark"]`), `toast` (announce on load), `prompt` (default `true`).

## Development

```sh
bun install          # dev only: types, OpenTUI for the render tests
bun test             # engine tests + OpenTUI integration tests (headless renderer)
bun run typecheck
bun scripts/demo.ts [filter] [--width 80] [--light] [--plain] [--file spec.json]
```

## License

MIT
