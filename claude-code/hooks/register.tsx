/**
 * charts — Claude Code mod: renders ```chart / ```spark blocks in Claude's
 * replies as inline terminal charts, and teaches the model the format.
 *
 * The chart engine (./engine) is the same one the OpenCode plugin uses, copied
 * here by scripts/sync-claude-mod.ts: spec in, rows of colored runs out. Here each run becomes a nested <Text>,
 * and the theme's semantic colors map onto Claude Code theme keys so charts
 * follow /theme.
 */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { ChartBlock } from '../types'
import { buildChart, parseBlock } from './engine/index'
import { strWidth } from './engine/text'
import type { ChartResult, Row, Theme } from './engine/types'
import { CHART_PROMPT } from './prompt'

const blocks = atom({ plugin: 'charts', key: 'blocks' } as const, {} as Record<string, ChartBlock>)
const nextKey = atom({ plugin: 'charts', key: 'next' } as const, 1)

/* ------------------------------------------------------------------ */
/* Theme: hex values for the engine's color math, theme keys to paint  */
/* ------------------------------------------------------------------ */

const DARK: Theme = {
  mode: 'dark',
  palette: ['#D77757', '#4782C8', '#4EBA65', '#AF87FF', '#FFC107', '#48968C', '#FF6B80', '#B1B9F9'],
  text: '#FFFFFF',
  muted: '#999999',
  grid: '#505050',
  up: '#4EBA65',
  down: '#FF6B80',
  warn: '#FFC107',
  info: '#4782C8',
  background: '#1E1E1E',
}

const LIGHT: Theme = {
  mode: 'light',
  palette: ['#D77757', '#4782C8', '#2C7A39', '#8700FF', '#966C1E', '#006666', '#AB2B3F', '#5769F7'],
  text: '#000000',
  muted: '#666666',
  grid: '#AFAFAF',
  up: '#2C7A39',
  down: '#AB2B3F',
  warn: '#966C1E',
  info: '#4782C8',
  background: '#FFFFFF',
}

/** Exact theme colors are painted with Claude Code's own keys (they follow /theme). */
function keysFor(t: Theme): Map<string, string> {
  const pairs: [string, string][] = [
    [t.text, 'text'],
    [t.muted, 'inactive'],
    [t.grid, 'subtle'],
    [t.up, 'success'],
    [t.down, 'error'],
    [t.warn, 'warning'],
    [t.palette[0]!, 'claude'],
    [t.palette[1]!, 'ide'],
    [t.palette[3]!, 'autoAccept'],
    [t.palette[5]!, 'planMode'],
    [t.palette[7]!, 'suggestion'],
  ]
  return new Map(pairs.map(([hex, key]) => [hex.toUpperCase(), key]))
}

const THEMES = {
  dark: { theme: DARK, keys: keysFor(DARK) },
  light: { theme: LIGHT, keys: keysFor(LIGHT) },
}

/* ------------------------------------------------------------------ */
/* Splitting a reply into markdown and chart blocks                    */
/* ------------------------------------------------------------------ */

type Segment = { kind: 'md'; text: string } | { kind: 'chart'; lang: string; body: string; closed: boolean }

const OPEN = /^\s{0,3}(`{3,}|~{3,})\s*(chart|spark)\s*$/
const HAS_CHART = /(^|\n)\s{0,3}(`{3,}|~{3,})\s*(chart|spark)\s*(\n|$)/

/** The line that closes a block opened by `fence` (same char, at least as long). */
function closerFor(fence: string): RegExp {
  return new RegExp(`^\\s{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
}

export type LiveBlock = { key: string; lang: string; body: string; closed: boolean }
type LiveState = { closer?: RegExp; open?: { key: string; lang: string; body: string[] } }

/** The line the live display shows in place of a block, and finds again at draw time. */
export const placeholder = (lang: string, key: string) => `◇ ${lang} ${key} · drawing…`
const PLACEHOLDER = /^◇ (chart|spark) (\d+) · drawing…$/

/**
 * While a reply streams, Claude Code shows its raw text, and the
 * AssistantMessage drawing then receives that shown text, not the stored one.
 * So the live display swaps each chart block for a keyed placeholder line
 * and hands the block back (`finished`) to be kept; the drawing puts it back.
 * The stored message and what the model sees are untouched.
 */
export function liveDisplay(
  state: LiveState,
  delta: string,
  alloc: () => string,
  final = false,
): { text: string; changed: boolean; finished: LiveBlock[] } {
  const out: string[] = []
  const finished: LiveBlock[] = []
  let changed = false
  // flushes are whole lines: keep the final newline apart so hiding a line hides it whole
  const newline = delta.endsWith('\n')
  const lines = (newline ? delta.slice(0, -1) : delta).split('\n')
  for (const line of lines) {
    if (state.closer && state.open) {
      changed = true
      if (state.closer.test(line)) {
        finished.push({ ...state.open, body: state.open.body.join('\n'), closed: true })
        state.closer = undefined
        state.open = undefined
      } else state.open.body.push(line)
      continue
    }
    const m = OPEN.exec(line)
    if (m) {
      changed = true
      state.closer = closerFor(m[1]!)
      state.open = { key: alloc(), lang: m[2]!, body: [] }
      out.push(placeholder(m[2]!, state.open.key))
      continue
    }
    out.push(line)
  }
  if (final && state.open) {
    finished.push({ ...state.open, body: state.open.body.join('\n'), closed: false })
    state.closer = undefined
    state.open = undefined
  }
  return { text: out.length ? out.join('\n') + (newline ? '\n' : '') : '', changed, finished }
}

/** Puts kept blocks back where the live display left their placeholders. */
export function restoreBlocks(text: string, blocks: Record<string, { lang: string; body: string; closed: boolean }>): string {
  if (!text.includes(' · drawing…')) return text
  return text
    .split('\n')
    .map(line => {
      const m = PLACEHOLDER.exec(line)
      const b = m ? blocks[m[2]!] : undefined
      return b ? ['```' + b.lang, b.body, ...(b.closed ? ['```'] : [])].join('\n') : line
    })
    .join('\n')
}

export function splitReply(text: string): Segment[] {
  const lines = text.split('\n')
  const out: Segment[] = []
  let md: string[] = []
  const flush = () => {
    if (md.join('').trim()) out.push({ kind: 'md', text: md.join('\n').replace(/^\n+|\n+$/g, '') })
    md = []
  }
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]!)
    if (!m) {
      md.push(lines[i]!)
      continue
    }
    const close = closerFor(m[1]!)
    const body: string[] = []
    let closed = false
    let j = i + 1
    for (; j < lines.length; j++) {
      if (close.test(lines[j]!)) {
        closed = true
        break
      }
      body.push(lines[j]!)
    }
    flush()
    out.push({ kind: 'chart', lang: m[2]!, body: body.join('\n'), closed })
    i = j
  }
  flush()
  return out
}

/* ------------------------------------------------------------------ */
/* The mod                                                             */
/* ------------------------------------------------------------------ */

// "⏺ " gutter of a reply + the card's border and padding
const CHROME = 2 + 4
const MAX_WIDTH = 140

export const register: Register = on => {
  let mode: 'dark' | 'light' = 'dark'

  // Claude Code keeps the theme in ~/.claude.json; light themes need the light palette
  on('session.start', async ($, e, next) => {
    try {
      const home = await $.env.get('HOME')
      if (home) {
        const cfg = JSON.parse(await $.fs.read(`${home}/.claude.json`)) as { theme?: unknown }
        mode = typeof cfg.theme === 'string' && cfg.theme.startsWith('light') ? 'light' : 'dark'
      }
    } catch {
      // unreadable: keep dark, the default theme
    }
    return next(e)
  })

  // live stream: show a placeholder instead of the chart JSON (display only),
  // keeping each block in session state for the drawing to put back
  const live = new Map<string, LiveState>()
  on('classic.MessageDisplay', async ($, e, next) => {
    const res = await next(e)
    const state = live.get(e.message_id) ?? {}
    let counter = await read($, nextKey)
    const first = counter
    const { text, changed, finished } = liveDisplay(state, res.displayContent ?? e.delta, () => String(counter++), e.final)
    if (counter !== first) await update($, nextKey, n => Math.max(n, counter))
    if (finished.length) {
      await update($, blocks, all => {
        const kept = { ...all }
        for (const b of finished) kept[b.key] = { lang: b.lang, body: b.body, closed: b.closed }
        // a session's worth: keep the newest 500
        const keys = Object.keys(kept)
        for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete kept[k]
        return kept
      })
    }
    if (e.final) live.delete(e.message_id)
    else live.set(e.message_id, state)
    return changed ? { ...res, displayContent: text } : res
  })

  // teach the model the ```chart format
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    if (res.sections.some(s => s.id === 'charts:format')) return res
    return { sections: [...res.sections, { id: 'charts:format', text: CHART_PROMPT, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // a reply shown live carries placeholders; the stored one (a resumed session) the blocks
    const text = e.props.text.includes(' · drawing…') ? restoreBlocks(e.props.text, await read($, blocks)) : e.props.text
    if (!HAS_CHART.test(text)) return next(e)
    const segments = splitReply(text)
    if (!segments.some(s => s.kind === 'chart')) return next(e)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    const { theme, keys } = THEMES[mode]
    const paint = (hex?: string) => (hex ? (keys.get(hex.toUpperCase()) ?? hex) : undefined)
    const width = Math.max(20, Math.min(MAX_WIDTH, (e.viewport?.columns ?? 100) - CHROME))

    const rowOf = (row: Row, i: number) => (
      <Text wrap="truncate-end">
        {row.length === 0
          ? ' '
          : row.map((run, j) => (
              <Text color={paint(run.fg)} backgroundColor={paint(run.bg)} bold={run.bold}>
                {run.text}
              </Text>
            ))}
      </Text>
    )

    const card = (seg: Extract<Segment, { kind: 'chart' }>, i: number) => {
      let res: ChartResult
      try {
        res = buildChart(parseBlock(seg.body, seg.lang), { width, theme })
      } catch (err) {
        if (!seg.closed) {
          return (
            <Text dimColor>
              ◇ {seg.lang} · drawing…
            </Text>
          )
        }
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
            <Text color="error">chart: {err instanceof Error ? err.message : String(err)}</Text>
          </Box>
        )
      }
      // snug card for narrow charts, full width for wide ones
      const natural = Math.max(1, ...res.rows.map(r => strWidth(r.map(x => x.text).join(''))), res.title ? strWidth(res.title) + 2 : 0)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} width={natural + 4}>
          {res.title ? (
            <Text bold color="text">
              ◇ {res.title}
            </Text>
          ) : null}
          {res.rows.map(rowOf)}
        </Box>
      )
    }

    // keep the reply's own look: "⏺" on its first block, everything indented two columns
    return (
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color="text">{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} gap={1}>
          {segments.map((s, i) => (s.kind === 'md' ? <Markdown text={s.text} /> : card(s, i)))}
        </Box>
      </Box>
    )
  })
}
