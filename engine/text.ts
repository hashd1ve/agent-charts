/**
 * text.ts — display-width aware string helpers.
 * Labels come from a model and may contain CJK or emoji (2 columns wide) or
 * combining marks (0 columns); padding by .length would break alignment.
 */

export function charWidth(cp: number): number {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x200d
  )
    return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2
  return 1
}

export function strWidth(s: string): number {
  let w = 0
  for (const ch of s) w += charWidth(ch.codePointAt(0)!)
  return w
}

/** Cuts `s` to at most `max` columns, ending in "…" when something was dropped. */
export function truncate(s: string, max: number): string {
  if (max <= 0) return ""
  if (strWidth(s) <= max) return s
  let out = ""
  let w = 0
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!)
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return out + "…"
}

export function padEnd(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - strWidth(s)))
}

export function padStart(s: string, w: number): string {
  return " ".repeat(Math.max(0, w - strWidth(s))) + s
}

export function center(s: string, w: number): string {
  const free = Math.max(0, w - strWidth(s))
  const left = Math.floor(free / 2)
  return " ".repeat(left) + s + " ".repeat(free - left)
}
