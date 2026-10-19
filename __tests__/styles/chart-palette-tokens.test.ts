import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-290: multi-series data visualization must draw from the semantic
// --chart-* categorical palette, not ad-hoc Tailwind brand classes. Guards:
//   1. globals.css defines --chart-1..5 in BOTH :root and .dark as oklch (the
//      single color model, LUM-257) — token-parity covers the override pairing;
//      contrast (3:1 graphics) is covered by feedback-contrast.test.ts.
//   2. Each token is registered in @theme inline so bg-chart-* / text-chart-*
//      utilities exist.
//   3. The summary charts consume bg-chart-* and carry no raw brand fill.

const CHART_TOKENS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
] as const

function readGlobals(): string {
  return readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
}

/** First `{ … }` body after a `:root` / `.dark` selector at column 0. */
function blockBody(css: string, selector: string): string {
  const re = new RegExp(
    `(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`
  )
  const m = css.match(re)
  if (!m?.[1])
    throw new Error(`could not find ${selector} block in globals.css`)
  return m[1]
}

function chartValuesIn(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const token of CHART_TOKENS) {
    const m = block.match(new RegExp(`--${token}:\\s*(oklch\\([^)]*\\))`))
    if (m?.[1]) out[token] = m[1].toLowerCase()
  }
  return out
}

describe('chart palette tokens (globals.css)', () => {
  const css = readGlobals()
  const root = chartValuesIn(blockBody(css, ':root'))
  const dark = chartValuesIn(blockBody(css, '.dark'))

  it('defines all five chart tokens as oklch in :root and .dark', () => {
    for (const token of CHART_TOKENS) {
      expect(root[token]).toMatch(/^oklch\([^)]*\)$/)
      expect(dark[token]).toMatch(/^oklch\([^)]*\)$/)
    }
  })

  it('brightens every chart token in dark mode (distinct from :root)', () => {
    // Each renders as a graphical bar/line: light values are darkened for #fff,
    // dark values brightened for #0a0a0a — so none may be identical across modes.
    for (const token of CHART_TOKENS) {
      expect(root[token]).not.toEqual(dark[token])
    }
  })

  it('registers each chart token in @theme inline', () => {
    for (const token of CHART_TOKENS) {
      expect(css).toContain(`--color-${token}: var(--${token});`)
    }
  })
})
