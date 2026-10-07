/**
 * json.ts — tolerant JSON parser.
 * Models often write almost-JSON: trailing commas, comments, single quotes,
 * unquoted keys, NaN. Strict JSON.parse runs first; this is the fallback.
 */

export function parseRelaxedJSON(src: string): unknown {
  try {
    return JSON.parse(src)
  } catch {
    return new Parser(src).parse()
  }
}

class Parser {
  private i = 0
  constructor(private readonly s: string) {}

  parse(): unknown {
    this.ws()
    const v = this.value()
    this.ws()
    if (this.i < this.s.length) this.fail("unexpected content after the value")
    return v
  }

  private fail(msg: string): never {
    const before = this.s.slice(0, this.i)
    const line = before.split("\n").length
    const col = this.i - before.lastIndexOf("\n")
    throw new Error(`invalid JSON (line ${line}, col ${col}): ${msg}`)
  }

  private ws(): void {
    const s = this.s
    while (this.i < s.length) {
      const c = s[this.i]
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿") this.i++
      else if (c === "/" && s[this.i + 1] === "/") while (this.i < s.length && s[this.i] !== "\n") this.i++
      else if (c === "#") while (this.i < s.length && s[this.i] !== "\n") this.i++
      else if (c === "/" && s[this.i + 1] === "*") {
        const end = s.indexOf("*/", this.i + 2)
        this.i = end < 0 ? s.length : end + 2
      } else break
    }
  }

  private value(): unknown {
    const c = this.s[this.i]
    if (c === "{") return this.object()
    if (c === "[") return this.array()
    if (c === '"' || c === "'") return this.string()
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return this.number()
    const word = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i))?.[0]
    if (word) {
      this.i += word.length
      switch (word) {
        case "true":
        case "True":
          return true
        case "false":
        case "False":
          return false
        case "null":
        case "None":
        case "undefined":
        case "NaN":
          return null
        case "Infinity":
          return Number.POSITIVE_INFINITY
      }
      this.i -= word.length
      this.fail(`unexpected word "${word}"`)
    }
    this.fail(c === undefined ? "unexpected end (unclosed bracket?)" : `unexpected "${c}"`)
  }

  private object(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    this.i++
    for (;;) {
      this.ws()
      const c = this.s[this.i]
      if (c === "}") {
        this.i++
        return out
      }
      if (c === undefined) this.fail("unclosed {")
      let key: string
      if (c === '"' || c === "'") key = this.string()
      else {
        const m = /^[^\s:,{}[\]"']+/.exec(this.s.slice(this.i))
        if (!m) this.fail(`expected a key, found "${c}"`)
        key = m[0]
        this.i += key.length
      }
      this.ws()
      if (this.s[this.i] !== ":" && this.s[this.i] !== "=") this.fail(`expected ":" after "${key}"`)
      this.i++
      this.ws()
      out[key] = this.value()
      this.ws()
      if (this.s[this.i] === ",") this.i++
      else if (this.s[this.i] !== "}") this.fail('expected "," or "}"')
    }
  }

  private array(): unknown[] {
    const out: unknown[] = []
    this.i++
    for (;;) {
      this.ws()
      const c = this.s[this.i]
      if (c === "]") {
        this.i++
        return out
      }
      if (c === undefined) this.fail("unclosed [")
      out.push(this.value())
      this.ws()
      if (this.s[this.i] === ",") this.i++
      else if (this.s[this.i] !== "]") this.fail('expected "," or "]"')
    }
  }

  private string(): string {
    const q = this.s[this.i++]
    let out = ""
    while (this.i < this.s.length) {
      const c = this.s[this.i++]
      if (c === q) return out
      if (c !== "\\") {
        out += c
        continue
      }
      const e = this.s[this.i++]
      if (e === "n") out += "\n"
      else if (e === "t") out += "\t"
      else if (e === "r") out += "\r"
      else if (e === "b") out += "\b"
      else if (e === "f") out += "\f"
      else if (e === "u") {
        out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16))
        this.i += 4
      } else out += e
    }
    this.fail("unclosed string")
  }

  private number(): number {
    const m = /^[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(this.s.slice(this.i))
    if (!m) this.fail("bad number")
    this.i += m[0].length
    return Number(m[0])
  }
}
