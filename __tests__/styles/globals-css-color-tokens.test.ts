import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

// LUM-240 guard: never wrap a CSS variable in hsl()/rgb(). When the token
// values were bare hex, `hsl(var(--token) / alpha)` expanded to
// `hsl(#1a1a1a / 0.12)` — invalid CSS, silently dropped, breaking the doc
// comment highlight and table insert handles. Tokens are now oklch (LUM-257),
// but the wrapping pattern is still wrong for either format, so keep guarding
// it. For alpha, use a Tailwind `/N` modifier on utilities, or
// `color-mix(in srgb, var(--token) N%, transparent)` in raw CSS.
it('app/globals.css never wraps a CSS var in hsl()/rgb()', () => {
  const offenders = css
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /(?:hsl|rgb)a?\(\s*var\(--/.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`)
  expect(offenders).toEqual([])
})

// LUM-257: base design tokens are a single color model — oklch — shared with
// the landing palette (components/landing/landing.css). oklch is perceptually
// uniform, so it's a clean derivation base for the semantic layer, and
// `var(--token)` stays valid wherever it's used directly in raw CSS. Guard
// against a regression back to hex (which reintroduces the LUM-240 hazard and
// splits the model in two again).
const COLOR_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
  'status-todo',
  'status-in-progress',
  'status-in-review',
  'status-done',
] as const

describe.each(COLOR_TOKENS)('--%s', (token) => {
  // Every definition of the token (it appears in both :root and .dark).
  const defs = [...css.matchAll(new RegExp(`--${token}:\\s*([^;]+);`, 'g'))].map((m) =>
    (m[1] ?? '').trim()
  )

  it('is defined at least once', () => {
    expect(defs.length).toBeGreaterThan(0)
  })

  it('every definition is an oklch() value, never a hex literal', () => {
    for (const value of defs) {
      expect(value).toMatch(/^oklch\(/)
      expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
