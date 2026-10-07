/**
 * prompt.ts — the cheat sheet that teaches a model to emit ```chart blocks.
 * The OpenCode plugin (index.ts) and the Claude Code plugin (prompt.compose)
 * both append it to the system prompt; it's also a good snippet for AGENTS.md.
 */

export const PROMPT_MARKER = "<!-- agent-charts -->"

export const CHART_PROMPT = `${PROMPT_MARKER}
## Inline charts
This terminal renders fenced \`\`\`chart blocks holding a JSON spec as inline charts. Use one when a picture helps (trend, comparison, distribution, composition, status); keep plain tables as Markdown.

\`\`\`chart
{"type":"line","title":"US unemployment","unit":"%","data":[["2024-01",3.7],["2024-02",3.9],["2024-03",3.8]]}
\`\`\`

Types and data:
- line | area | step: "data":[[label,value],…] (YYYY, YYYY-MM, YYYY-MM-DD and YYYY-Qn labels go on a time axis; null = gap), or "series":[{"name":"A","data":[…]},…]. Options: "log":true, "zero":true, "yMin"/"yMax", "refs":[{"y":2,"label":"target"}]; area with several series + "stacked":true (or "percent":true) = composition over time.
- drawdown: prices as for line → % fall from the running peak, with max drawdown and its peak.
- scatter: "data":[[x,y],…]; "trend":true adds a regression line and r².
- bar (horizontal) / column (vertical): "data":{"A":450,"B":320} or [[label,value],…]; "sort":true; several "series" are grouped, "stacked":true stacks, "percent":true for 100% bars (bar only); "highlight":"A" (bar).
- hist: "data":[raw values], optional "bins".
- heat: "xLabels":[…],"yLabels":[…],"z":[[row],…] (null = blank); both signs → diverging colors (e.g. monthly returns).
- calendar: "data":[["2026-03-01",value],…] daily values, GitHub-style grid.
- candle: "data":[[date,open,high,low,close,volume?],…].
- pie | donut: "data":{"A":60,"B":40}.
- gauge: "data":{"CPU":72,"RAM":45},"max":100, optional "thresholds":[60,85], "target".
- stat: KPI tiles, "data":[{"label":"S&P 500","value":5832.9,"change":1.2,"spark":[…]},…] ("change" in %, or "delta" absolute, or "previous"; "lowerIsBetter":true flips colors).
- dumbbell: before → after per category, "labels":["2023","2025"],"data":[["Fed",5.5,4.5],…] (or two "series").
- box: "data":{"group":[raw values],…}.
- waterfall: "data":[["Start",100],["Price",12],["Costs",-5]],"total":"End".
- spark: "data":[numbers] (one line); with "series" → watchlist rows (last value, change).
Common options: "title", "subtitle", "unit" ("%","$","ms"…), "height" (rows), "colors":["#hex",…], "note"/"source".
Keep it readable: ≤150 points per line, ≤20 bars, short labels (YYYY-MM), one chart per block, nothing but the JSON inside the block.`
