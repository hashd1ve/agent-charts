# opencode-charts

Inline braille charts for the [OpenCode](https://opencode.ai) v2 TUI — no PNGs, no external tools, no images. Ask your agent for a chart and it renders directly on the terminal grid, even over SSH.

A CLI plugin that registers custom renderers for ` ```chart ` and ` ```spark ` fenced code blocks. The model just writes a JSON spec in a code block; the plugin parses it and paints it using Unicode braille characters (each character = a 2×4 dot grid, ~8× the vertical resolution of plain text).

## Install

1. Copy this folder anywhere, e.g. `~/.config/opencode/plugins/charts/`.
2. Register it in your OpenCode config (`~/.config/opencode/cli.json` or equivalent):

```json
{
  "plugins": [
    "~/.config/opencode/plugins/charts"
  ]
}
```

3. Restart OpenCode. You'll see a toast: `charts plugin: chart/spark renderers active`.

No npm dependencies — the plugin uses the `@opencode/plugin` and `@opentui/core` modules already provided by the OpenCode runtime.

## Usage

Ask your agent to draw a chart and have it emit a `chart` block like:

````
```chart
{"type":"line","title":"Unemployment rate (%)","data":[["2024-10",4.1],["2024-11",4.2],["2024-12",4.1]]}
```
````

### Supported chart types

| Type | Spec | Use case |
|---|---|---|
| `line` | `"data":[["2024-10",4.1],...]` | time series, trends |
| `line` multi-series | `"series":[{"name":"CPI","data":[...]},...]` | comparisons |
| `area` | like `line` | line with gradient fill, clear-trend series |
| `step` | like `line` | stepped data: rate bands, thresholds |
| `bar` | `"data":{"Laptops":450,"Monitors":320}` | comparisons |
| `heat` | `"xLabels":[...],"yLabels":[...],"z":[[row],...]` | month×year matrices, tables |
| `hist` | `"data":[values],"bins":8` | distributions |
| `candle` | `"data":[["03 oct",open,high,low,close],...]` | OHLC, price action |
| `scatter` | `"data":[[x,y],...]` | correlations |
| `spark` | `"data":[4.1,4.2,4.0]` | one-line sparklines |

Options: `width`, `height`, `unit` (value suffix, e.g. `"%)"` → use `"unit":"%"`), `yMin`, `yMax`, `bins` (hist only), per-series `color`.

Non-JSON fallback: a `chart` or `spark` block containing only bare numbers renders as a line/sparkline automatically.

### Prompting tips for agents

- Keep `line`/`area` series under ~60 points, `bar` under ~12.
- Use short labels (`YYYY-MM` or `YYYY`).
- Sample long daily series; use `spark` when in doubt.
- Series with a clear trend → `area`; flat segments → `step`; matrix data → `heat`; distributions → `hist`.

## How it works

- `chart.ts` — pure, zero-dependency chart engine. Takes a spec, returns rows of colored text runs. Includes a `BrailleCanvas` (Bresenham lines, dithered gradient fills for `area`, dot-level candle bodies) and a TokyoNight-flavored palette.
- `tui.ts` — the CLI plugin. Hooks OpenCode's markdown code-block renderer for the `chart` and `spark` languages and maps the engine's runs onto `@opentui/core` text renderables, with graceful error boxes on bad specs.
- `index.ts` — server-side entry (no hooks; required for plugin discovery).

## License

MIT
