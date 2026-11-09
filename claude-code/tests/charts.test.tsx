import { describe, expect, test } from 'claude-code/testing'
import { liveDisplay, placeholder, restoreBlocks, splitReply } from '../hooks/register'

const LINE = '{"type":"line","title":"Unemployment","unit":"%","data":[["2024-01",3.7],["2024-02",3.9],["2024-03",3.8],["2024-04",4.1]]}'

const reply = (text: string) => ({
  plugin: 'charts',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 100, rows: 40 },
})

describe('splitReply', () => {
  test('separates prose from chart blocks', () => {
    const segs = splitReply(`Here:\n\n\`\`\`chart\n${LINE}\n\`\`\`\n\nDone.`)
    expect(segs.map(s => s.kind)).toEqual(['md', 'chart', 'md'])
    expect(segs[1]).toEqual({ kind: 'chart', lang: 'chart', body: LINE, closed: true })
  })

  test('an unterminated block is open (still streaming)', () => {
    const segs = splitReply('```spark\n1 2 3')
    expect(segs).toEqual([{ kind: 'chart', lang: 'spark', body: '1 2 3', closed: false }])
  })

  test('other code fences are left alone', () => {
    expect(splitReply('```ts\nconst a = 1\n```').map(s => s.kind)).toEqual(['md'])
  })

  test('a chart block inside another code fence is an example, not a chart', () => {
    for (const text of ['````\n```chart\n{"data":[1]}\n```\n````', '~~~\n```chart\n{"data":[1]}\n```\n~~~']) {
      expect(splitReply(text).map(s => s.kind)).toEqual(['md'])
    }
    expect(splitReply('```ts\nx\n```\n```chart\n1 2\n```').map(s => s.kind)).toEqual(['md', 'chart'])
  })

  test('a fence indented past 3 columns opens a chart only inside a list', () => {
    expect(splitReply('10. item\n\n    ```chart\n    1 2 3\n    ```\n').map(s => s.kind)).toEqual(['md', 'chart'])
    expect(splitReply('para\n\n    ```chart\n    1 2 3\n    ```\n').map(s => s.kind)).toEqual(['md'])
  })

  test('a fence on the list-marker line closes normally, so later charts still draw', () => {
    for (const item of ['- ```python', '1. ```bash']) {
      expect(splitReply(`${item}\n   x = 1\n   \`\`\`\n\nDone:\n\n\`\`\`chart\n1 2\n\`\`\`\n`).map(s => s.kind)).toEqual(['md', 'chart'])
    }
  })

  test('replies with CRLF line ends still draw', () => {
    expect(splitReply('hola\r\n```chart\r\n1 2 3\r\n```\r\nfin').map(s => s.kind)).toEqual(['md', 'chart', 'md'])
  })

  test('a column-0 fence or a thematic break ends the list, so indented code stays code', () => {
    const indented = '\n\n    ```chart\n    1 2 3\n    ```\n'
    expect(splitReply('- a\n```\ncode\n```' + indented).map(s => s.kind)).toEqual(['md'])
    expect(splitReply('* * *' + indented).map(s => s.kind)).toEqual(['md'])
  })
})

describe('system prompt', () => {
  test('teaches the format only where charts are drawn', async ($, on) => {
    on('prompt.compose', () => ({ sections: [] })) // the engine beneath
    const model = 'claude-test'
    const ids = async (surfaces: ('terminal' | 'desktop')[]) =>
      (await $.prompt.compose({ model, promptModel: model, surfaces, tools: [], outputStyle: null, traits: [] })).sections.map(s => s.id)
    expect(await ids(['terminal'])).toContain('charts:format')
    expect(await ids(['terminal', 'desktop'])).toContain('charts:format')
    expect(await ids(['desktop'])).not.toContain('charts:format')
    expect(await ids([])).not.toContain('charts:format')
  })
})

describe('AssistantMessage', () => {
  test('a chart block draws as a titled card with braille rows', async $ => {
    const ui = await $.ui.mount(reply(`Here you go:\n\n\`\`\`chart\n${LINE}\n\`\`\`\n\nDone.`))
    expect(await ui.find({ type: 'Text', text: /◇ Unemployment/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /[⠁-⣿]/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /last 4\.1%/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /Here you go/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /Done\./ })).toBeDefined()
    await ui.unmount()
  })

  test('a streaming block shows a placeholder, a broken closed one an error', async $ => {
    const streaming = await $.ui.mount(reply('```chart\n{"type":"line","data":[[1,'))
    expect(await streaming.find({ type: 'Text', text: /drawing/ })).toBeDefined()
    await streaming.unmount()
    const broken = await $.ui.mount(reply('```chart\n{"type":"radar","data":[1,2]}\n```'))
    expect(await broken.find({ type: 'Text', text: /unknown type/ })).toBeDefined()
    await broken.unmount()
  })

  test('replies without charts are left to the engine', async ($, on) => {
    // stands for the engine's own drawing beneath the plugin
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine drew it</Text>
    })
    const ui = await $.ui.mount(reply('just **text** and\n\n```ts\nconst a = 1\n```'))
    expect(await ui.find({ type: 'Text', text: /engine drew it/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◇/ })).toBeUndefined()
    await ui.unmount()
  })

  test('theme colors are painted with theme keys', async $ => {
    const ui = await $.ui.mount(reply('```chart\n{"type":"bar","data":{"a":3,"b":-2}}\n```'))
    const runs = await ui.findAll({ type: 'Text' })
    const colors = new Set(runs.map(r => r.props.color).filter(Boolean))
    expect(colors.has('success')).toBe(true)
    expect(colors.has('error')).toBe(true)
    await ui.unmount()
  })
})

describe('live streaming display', () => {
  const counter = () => {
    let n = 1
    return () => String(n++)
  }

  test('chart JSON becomes one keyed placeholder line, the block is handed back', () => {
    const state = {}
    const alloc = counter()
    expect(liveDisplay(state, 'Hola\n```chart\n{"type":"line",\n', alloc).text).toBe(`Hola\n${placeholder('chart', '1')}\n`)
    expect(liveDisplay(state, '"data":[1,2,3]}\n', alloc)).toEqual({ text: '', changed: true, finished: [] })
    const end = liveDisplay(state, '```\nFin\n', alloc)
    expect(end.text).toBe('Fin\n')
    expect(end.finished).toEqual([{ key: '1', lang: 'chart', body: '{"type":"line",\n"data":[1,2,3]}', closed: true }])
  })

  test('text without charts is left untouched', () => {
    expect(liveDisplay({}, 'just text\n```ts\nconst a = 1\n```\n', counter())).toEqual({
      text: 'just text\n```ts\nconst a = 1\n```\n',
      changed: false,
      finished: [],
    })
  })

  test('a chart block inside another code fence streams as plain text', () => {
    const text = '````\n```chart\n{"data":[1]}\n```\n````\n'
    expect(liveDisplay({}, text, counter())).toEqual({ text, changed: false, finished: [] })
  })

  test('a reply that ends inside a block closes it, so it is drawn or reported', () => {
    const state = {}
    const alloc = counter()
    liveDisplay(state, '```chart\n{"type":"bar",\n', alloc)
    const { finished } = liveDisplay(state, '', alloc, true)
    expect(finished.map(b => b.closed)).toEqual([true])
  })

  test('a restored block whose body holds backticks survives the round trip', () => {
    const shown = restoreBlocks(placeholder('chart', '7'), { '7': { lang: 'chart', body: 'a,1\n```,2', closed: true } })
    expect(splitReply(shown)).toEqual([{ kind: 'chart', lang: 'chart', body: 'a,1\n```,2', closed: true }])
  })

  test('restoreBlocks puts the JSON back where the placeholder is', () => {
    const shown = `Mira:\n${placeholder('chart', '7')}\nListo.`
    expect(restoreBlocks(shown, { '7': { lang: 'chart', body: '{"data":[1,2]}', closed: true } })).toBe('Mira:\n```chart\n{"data":[1,2]}\n```\nListo.')
    expect(restoreBlocks(shown, {})).toBe(shown)
  })

  test('overlapping flushes of one message still share its state', async ($, on) => {
    on('classic.MessageDisplay', () => ({})) // the engine beneath: no rewrite of its own
    const base = { turn_id: 't2', message_id: 'm2' }
    // after a tool call the rest of a reply often lands at once: the second flush starts before the first ends
    const [a, b] = await Promise.all([
      $.classic.MessageDisplay({ ...base, index: 0, final: false, delta: '```chart\n' }),
      $.classic.MessageDisplay({ ...base, index: 1, final: true, delta: '{"type":"bar","title":"Race","data":{"a":1}}\n```' }),
    ])
    expect(a.displayContent).toMatch(/^◇ chart \d+ · drawing…\n$/)
    expect(b.displayContent).toBe('')
    const ui = await $.ui.mount(reply(`${a.displayContent}${b.displayContent}`))
    expect(await ui.find({ type: 'Text', text: /◇ Race/ })).toBeDefined()
    await ui.unmount()
  })

  test('streamed reply: placeholder while streaming, chart once drawn', async ($, on) => {
    on('classic.MessageDisplay', () => ({})) // the engine beneath: no rewrite of its own
    const base = { turn_id: 't1', message_id: 'm1', final: false }
    const a = await $.classic.MessageDisplay({ ...base, index: 0, delta: 'Mira:\n```chart\n{"type":"bar","title":"Live",\n' })
    expect(a.displayContent).toMatch(/^Mira:\n◇ chart \d+ · drawing…\n$/)
    const b = await $.classic.MessageDisplay({ ...base, index: 1, delta: '"data":{"a":1,"b":2}}\n```\nListo.\n', final: true })
    expect(b.displayContent).toBe('Listo.\n')
    // the drawing receives the shown text (placeholder), as Claude Code passes it
    const shown = `${a.displayContent}${b.displayContent}`
    const ui = await $.ui.mount(reply(shown))
    expect(await ui.find({ type: 'Text', text: /◇ Live/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /drawing/ })).toBeUndefined()
    await ui.unmount()
  })
})
