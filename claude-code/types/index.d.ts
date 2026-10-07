/** A chart block captured while a reply streamed, keyed by its placeholder. */
export type ChartBlock = { lang: string; body: string; closed: boolean }

declare module 'claude-code' {
  interface PluginState {
    charts: {
      /** Blocks whose JSON the live display hid, by placeholder key. */
      blocks: Record<string, ChartBlock>
      /** Next placeholder key. */
      next: number
    }
  }
}
