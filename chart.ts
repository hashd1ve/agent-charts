/**
 * chart.ts — public API of the chart engine (kept for backwards compatibility;
 * the implementation lives in ./engine).
 *
 *   buildChart(spec, { width, theme })   spec object → rows of styled runs
 *   buildFromText(text, lang, opts)      raw ```chart / ```spark body → rows
 */
export { buildChart, buildFromText, parseBlock, specFromText, DARK, LIGHT, resolveTheme, TYPES } from "./engine"
export type { BuildOptions, ChartResult, Row, Run, Theme } from "./engine"

import { buildFromText } from "./engine"
import type { BuildOptions, ChartResult } from "./engine"

/** @deprecated use buildFromText — kept for v1 callers. */
export function buildFromPlainText(text: string, lang: string, opts: BuildOptions = {}): ChartResult {
  return buildFromText(text, lang, opts)
}
