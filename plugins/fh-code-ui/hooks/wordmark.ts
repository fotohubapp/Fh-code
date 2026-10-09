// "FOTOhub API" in a two-row block font, coloured column by column along the
// FOTOhub gradient (violet to fuchsia to rose).

const GLYPHS: Record<string, [string, string]> = {
  F: ['█▀▀', '█▀ '],
  O: ['█▀█', '█▄█'],
  T: ['▀█▀', ' █ '],
  h: ['█ █', '█▀█'],
  u: ['█ █', '█▄█'],
  b: ['█▄▄', '█▄█'],
  A: ['▄▀█', '█▀█'],
  P: ['█▀█', '█▀▀'],
  I: ['█', '█'],
  ' ': [' ', ' '],
}

const STOPS: [number, number, number][] = [
  [124, 58, 237], // #7c3aed violet
  [192, 38, 211], // #c026d3 fuchsia
  [244, 63, 94], // #f43f5e rose
]

export function gradient(t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (STOPS.length - 1)
  const i = Math.min(Math.floor(x), STOPS.length - 2)
  const f = x - i
  const a = STOPS[i] ?? STOPS[0]!
  const b = STOPS[i + 1] ?? a
  const c = a.map((v, k) => Math.round(v + ((b[k] ?? v) - v) * f))
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/** The wordmark's two rows, each a list of [text, colour] runs of one cell. */
export function wordmark(text: string): [string, string][][] {
  const top: [string, string][] = []
  const bottom: [string, string][] = []
  const letters = [...text]
  const width = letters.reduce((n, ch) => n + (GLYPHS[ch]?.[0].length ?? 1) + 1, 0)
  let col = 0
  for (const ch of letters) {
    const [upper, lower] = GLYPHS[ch] ?? [ch, ' ']
    ;[...upper].forEach((cell, k) => top.push([cell, gradient((col + k) / width)]))
    ;[...lower].forEach((cell, k) => bottom.push([cell, gradient((col + k) / width)]))
    top.push([' ', 'text'])
    bottom.push([' ', 'text'])
    col += upper.length + 1
  }
  return [top, bottom]
}
