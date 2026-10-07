/**
 * grid.ts — a fixed-size grid of styled terminal cells.
 * Every chart draws into a CellGrid and converts it to rows at the end, so a
 * chart can never exceed the width it was given.
 */
import { charWidth, strWidth } from "./text"
import type { Row, Run } from "./types"

export type Cell = { ch: string; fg?: string; bg?: string; bold?: boolean }

/** Marks the right half of a wide (2-column) character. */
const CONT = ""

export class CellGrid {
  readonly w: number
  readonly h: number
  private readonly cells: Cell[]

  constructor(w: number, h: number) {
    this.w = Math.max(0, Math.floor(w))
    this.h = Math.max(0, Math.floor(h))
    this.cells = Array.from({ length: this.w * this.h }, () => ({ ch: " " }))
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  get(x: number, y: number): Cell | undefined {
    return this.inside(x, y) ? this.cells[y * this.w + x] : undefined
  }

  set(x: number, y: number, ch: string, fg?: string, bg?: string, bold?: boolean): void {
    x = Math.floor(x)
    y = Math.floor(y)
    if (!this.inside(x, y)) return
    const i = y * this.w + x
    const old = this.cells[i]
    // never leave half of a 2-column glyph behind
    if (old.ch === CONT && x > 0 && ch !== CONT) this.cells[i - 1] = { ch: " " }
    else if (x + 1 < this.w && this.cells[i + 1].ch === CONT && charWidth(old.ch.codePointAt(0) ?? 32) === 2) this.cells[i + 1] = { ch: " " }
    this.cells[i] = { ch, fg, bg, bold }
  }

  /** Sets only the background, keeping glyph and foreground. */
  tint(x: number, y: number, bg: string): void {
    const c = this.get(Math.floor(x), Math.floor(y))
    if (c) c.bg = bg
  }

  isBlank(x: number, y: number): boolean {
    const c = this.get(x, y)
    return !!c && c.ch === " " && !c.bg
  }

  /** Writes a string starting at column x; returns the columns used. */
  text(x: number, y: number, s: string, fg?: string, opts: { bg?: string; bold?: boolean } = {}): number {
    x = Math.floor(x)
    let col = x
    for (const ch of s) {
      const cw = charWidth(ch.codePointAt(0)!)
      if (cw === 0) continue
      if (col + cw > this.w) break
      if (col >= 0) {
        this.set(col, y, ch, fg, opts.bg, opts.bold)
        if (cw === 2) this.set(col + 1, y, CONT, fg, opts.bg, opts.bold)
      }
      col += cw
    }
    return col - x
  }

  textRight(xEnd: number, y: number, s: string, fg?: string, opts: { bg?: string; bold?: boolean } = {}): void {
    this.text(xEnd - strWidth(s), y, s, fg, opts)
  }

  rows(): Row[] {
    const out: Row[] = []
    for (let y = 0; y < this.h; y++) {
      // trailing unstyled blanks carry no information
      let end = this.w
      while (end > 0) {
        const c = this.cells[y * this.w + end - 1]
        if (c.ch === " " && !c.bg) end--
        else break
      }
      const row: Run[] = []
      let cur: Run | undefined
      for (let x = 0; x < end; x++) {
        const c = this.cells[y * this.w + x]
        if (c.ch === CONT) continue
        const blank = c.ch === " " && !c.bg
        const fg = blank ? undefined : c.fg
        if (cur && cur.fg === fg && cur.bg === c.bg && !!cur.bold === !!c.bold) {
          cur.text += c.ch
        } else {
          cur = { text: c.ch, fg, bg: c.bg, bold: c.bold || undefined }
          row.push(cur)
        }
      }
      out.push(row)
    }
    return out
  }
}

/** Cuts a row to `width` columns (last line of defence for the width contract). */
export function clipRow(row: Row, width: number): Row {
  let left = width
  const out: Row = []
  for (const run of row) {
    if (left <= 0) break
    const w = strWidth(run.text)
    if (w <= left) {
      out.push(run)
      left -= w
      continue
    }
    let text = ""
    let used = 0
    for (const ch of run.text) {
      const cw = charWidth(ch.codePointAt(0)!)
      if (used + cw > left) break
      text += ch
      used += cw
    }
    if (text) out.push({ ...run, text })
    left = 0
  }
  return out
}

/** Width of a row in terminal columns. */
export function rowWidth(row: Row): number {
  return row.reduce((w, r) => w + strWidth(r.text), 0)
}
