/**
 * canvas.ts — sub-cell drawing surfaces.
 *
 *  BrailleCanvas  each cell is a 2×4 dot matrix (U+2800 block): 8× the
 *                 resolution of plain text, one color per cell.
 *  PixelCanvas    each cell is two square-ish pixels stacked vertically,
 *                 painted with ▀/▄ and fg+bg: full color per pixel.
 *  hbar/vbar      fractional bar ends with eighth blocks (▏▎▍▌▋▊▉█ / ▁▂▃▄▅▆▇█).
 */
import type { CellGrid } from "./grid"

const BIT_COL0 = [0x01, 0x02, 0x04, 0x40]
const BIT_COL1 = [0x08, 0x10, 0x20, 0x80]

/** Paint priority: a higher layer owns the cell color; grid dots yield to anything. */
export const LAYER = { grid: 1, fill: 2, ref: 3, line: 4, point: 5 } as const

export class BrailleCanvas {
  readonly cols: number
  readonly rows: number
  readonly dotsW: number
  readonly dotsH: number
  private readonly bits: Uint8Array
  private readonly layer: Uint8Array
  private readonly color: (string | undefined)[]

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)
    this.dotsW = this.cols * 2
    this.dotsH = this.rows * 4
    this.bits = new Uint8Array(this.cols * this.rows)
    this.layer = new Uint8Array(this.cols * this.rows)
    this.color = new Array(this.cols * this.rows)
  }

  dot(x: number, y: number, color: string, layer: number = LAYER.line): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.dotsW || y >= this.dotsH) return
    const i = (y >> 2) * this.cols + (x >> 1)
    const bit = (x & 1) === 0 ? BIT_COL0[y & 3] : BIT_COL1[y & 3]
    const cur = this.layer[i]
    if (layer === LAYER.grid && cur > LAYER.grid) return
    if (cur === LAYER.grid && layer > LAYER.grid) this.bits[i] = 0
    this.bits[i] |= bit
    if (layer >= cur) {
      this.layer[i] = layer
      this.color[i] = color
    }
  }

  /** Bresenham line on the dot grid. */
  line(x0: number, y0: number, x1: number, y1: number, color: string, layer: number = LAYER.line): void {
    let x = Math.round(x0)
    let y = Math.round(y0)
    const xe = Math.round(x1)
    const ye = Math.round(y1)
    const dx = Math.abs(xe - x)
    const dy = -Math.abs(ye - y)
    const sx = x < xe ? 1 : -1
    const sy = y < ye ? 1 : -1
    let err = dx + dy
    for (let guard = 0; guard < 100000; guard++) {
      this.dot(x, y, color, layer)
      if (x === xe && y === ye) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  /** Dashed line: `on` dots drawn, `off` skipped. */
  dashed(x0: number, y0: number, x1: number, y1: number, color: string, layer: number, on = 2, off = 2): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let k = 0; k <= n; k++) {
      if (k % (on + off) >= on) continue
      const t = n === 0 ? 0 : k / n
      this.dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color, layer)
    }
  }

  /** Horizontal dotted grid line at dot row y. */
  gridRow(y: number, color: string): void {
    for (let x = 0; x < this.dotsW; x += 2) this.dot(x, y, color, LAYER.grid)
  }

  /** Copies non-empty cells into the grid at (ox, oy). */
  blit(grid: CellGrid, ox: number, oy: number): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c
        if (this.bits[i] === 0) continue
        grid.set(ox + c, oy + r, String.fromCharCode(0x2800 + this.bits[i]), this.color[i])
      }
    }
  }
}

export class PixelCanvas {
  readonly cols: number
  readonly rows: number
  readonly pxW: number
  readonly pxH: number
  private readonly px: (string | undefined)[]

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)
    this.pxW = this.cols
    this.pxH = this.rows * 2
    this.px = new Array(this.pxW * this.pxH)
  }

  set(x: number, y: number, color: string): void {
    if (x < 0 || y < 0 || x >= this.pxW || y >= this.pxH) return
    this.px[y * this.pxW + x] = color
  }

  blit(grid: CellGrid, ox: number, oy: number): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const top = this.px[2 * r * this.pxW + c]
        const bot = this.px[(2 * r + 1) * this.pxW + c]
        if (!top && !bot) continue
        if (top && bot) {
          if (top === bot) grid.set(ox + c, oy + r, "█", top)
          else grid.set(ox + c, oy + r, "▀", top, bot)
        } else if (top) grid.set(ox + c, oy + r, "▀", top)
        else grid.set(ox + c, oy + r, "▄", bot)
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fractional bars                                                     */
/* ------------------------------------------------------------------ */

/** Left-aligned eighths: index k = k/8 of the cell filled from the left. */
export const LEFT_EIGHTHS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"]
/** Bottom-aligned eighths. */
export const LOWER_EIGHTHS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

const LEFT_SET = new Set(LEFT_EIGHTHS.slice(1, 8))

/**
 * Horizontal bar covering [a, b) in fractional cell units from column `ox`.
 * The left edge only has ▕/▐ available (right-aligned partials), the right
 * edge has full eighth precision. A left partial that lands on a cell whose
 * right part is free but whose left part holds another segment's tail becomes
 * that cell's background, so stacked segments meet without a gap.
 */
export function hbar(grid: CellGrid, ox: number, y: number, a: number, b: number, color: string): void {
  if (!(b > a)) return
  const ia = Math.floor(a)
  const ib = Math.floor(b - 1e-9)
  if (ia === ib) {
    const cov = b - a
    if (cov >= 0.875) grid.set(ox + ia, y, "█", color)
    else if (a - ia < 0.2) grid.set(ox + ia, y, LEFT_EIGHTHS[Math.max(1, Math.round(cov * 8))], color)
    else grid.set(ox + ia, y, cov >= 0.375 ? "▐" : "▕", color)
    return
  }
  // left edge
  const leftCov = 1 - (a - ia)
  const existing = grid.get(ox + ia, y)
  if (leftCov >= 0.875) grid.set(ox + ia, y, "█", color)
  else if (existing && LEFT_SET.has(existing.ch) && existing.fg && existing.fg !== color) grid.tint(ox + ia, y, color)
  else if (leftCov >= 0.375) grid.set(ox + ia, y, "▐", color)
  else if (leftCov >= 0.0625) grid.set(ox + ia, y, "▕", color)
  for (let x = ia + 1; x < ib; x++) grid.set(ox + x, y, "█", color)
  // right edge
  const rightCov = b - ib
  const k = Math.round(rightCov * 8)
  if (k > 0) grid.set(ox + ib, y, LEFT_EIGHTHS[Math.min(8, k)], color)
}

/**
 * Vertical bar of fractional height `h` (rows) growing up from the bottom of
 * row `baseRow` (exclusive top edge at baseRow+1). Drawn with lower eighths.
 */
export function vbarUp(grid: CellGrid, x: number, baseRow: number, h: number, color: string, w = 1): void {
  if (!(h > 0)) return
  const full = Math.floor(h + 1e-9)
  const k = Math.round((h - full) * 8)
  for (let dx = 0; dx < w; dx++) {
    for (let r = 0; r < full; r++) grid.set(x + dx, baseRow - r, "█", color)
    if (k > 0) grid.set(x + dx, baseRow - full, LOWER_EIGHTHS[k], color)
    else if (full === 0) grid.set(x + dx, baseRow, "▁", color)
  }
}

/** Vertical bar growing down from the top of row `topRow`; half-row precision (▀). */
export function vbarDown(grid: CellGrid, x: number, topRow: number, h: number, color: string, w = 1): void {
  if (!(h > 0)) return
  const full = Math.floor(h + 1e-9)
  const rest = h - full
  for (let dx = 0; dx < w; dx++) {
    for (let r = 0; r < full; r++) grid.set(x + dx, topRow + r, "█", color)
    if (rest >= 0.25 || full === 0) grid.set(x + dx, topRow + full, rest >= 0.75 ? "█" : rest >= 0.25 || full === 0 ? "▀" : "▔", color)
  }
}
