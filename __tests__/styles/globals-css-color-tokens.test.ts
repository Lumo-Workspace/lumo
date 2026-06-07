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
  // LUM-262: --ring / --sidebar-ring are no longer per-token oklch literals —
  // they derive from the single --focus-ring source (guarded separately below).
  'focus-ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'status-todo',
  'status-in-progress',
  'status-in-review',
  'status-done',
  // LUM-258 semantic feedback colors (solid oklch accents + near-black foregrounds).
  'info',
  'info-foreground',
  'warning',
  'warning-foreground',
  'success',
  'success-foreground',
  'danger',
  'danger-foreground',
  // LUM-263 priority colors (oklch; light contrast-corrected, dark bright).
  'priority-urgent',
  'priority-high',
  'priority-medium',
  'priority-low',
] as const

describe.each(COLOR_TOKENS)('--%s', token => {
  // Every definition of the token (it appears in both :root and .dark).
  const defs = [
    ...css.matchAll(new RegExp(`--${token}:\\s*([^;]+);`, 'g')),
  ].map(m => (m[1] ?? '').trim())

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

// LUM-262: focus ring is a single source of truth. --focus-ring holds the one
// brand-blue focus accent (guarded as oklch in COLOR_TOKENS above, defined once
// in :root so it's identical across light/dark). Both --ring (generic) and
// --sidebar-ring derive from it via var(), so the app has exactly one focus
// color language instead of the old grey-vs-blue split. Guard that neither
// re-splits into its own literal value or a per-mode override again.
describe('focus ring derives from a single --focus-ring source', () => {
  it.each(['ring', 'sidebar-ring'])(
    '--%s is defined exactly once as var(--focus-ring)',
    token => {
      const defs = [
        ...css.matchAll(new RegExp(`--${token}:\\s*([^;]+);`, 'g')),
      ].map(m => (m[1] ?? '').trim())
      expect(defs).toHaveLength(1) // no .dark override — single source, both modes
      expect(defs[0]).toBe('var(--focus-ring)')
    }
  )

  it('--focus-ring is defined once (no per-mode override)', () => {
    const defs = [...css.matchAll(/--focus-ring:\s*([^;]+);/g)]
    expect(defs).toHaveLength(1)
  })
})

// LUM-258: -subtle / -border are translucent color-mix of the accent, defined
// ONCE in :root (no .dark override). Translucent so they composite over
// --background and adapt to dark mode automatically — that's what lets the
// duplicated .dark callout palette be deleted.
describe.each(['info', 'warning', 'success', 'danger'])(
  '--%s subtle/border',
  c => {
    it.each(['subtle', 'border'])(
      `--${c}-%s is a single color-mix over var(--${c})`,
      variant => {
        const re = new RegExp(`--${c}-${variant}:\\s*([^;]+);`, 'g')
        const defs = [...css.matchAll(re)].map(m => (m[1] ?? '').trim())
        expect(defs).toHaveLength(1) // defined once, no per-mode duplicate
        expect(defs[0]).toMatch(
          new RegExp(
            `^color-mix\\(in srgb, var\\(--${c}\\) \\d+%, transparent\\)$`
          )
        )
      }
    )
  }
)

// LUM-258: the .dark block must brighten the four accents (regression guard so
// the dark-mode accent override isn't lost in a future edit).
describe('.dark feedback accent overrides', () => {
  const darkBlock = css.slice(
    css.indexOf('.dark {'),
    css.indexOf('@theme inline')
  )
  it.each(['info', 'warning', 'success', 'danger'])(
    '.dark redefines --%s',
    c => {
      expect(darkBlock).toMatch(new RegExp(`--${c}:\\s*oklch\\(`))
    }
  )
})

// LUM-263: priority colors mirror the status approach — light mode is the
// contrast offender for small graphics, so high/medium/low are darkened in
// :root and kept bright in .dark. urgent (red) passes both modes (single def).
describe('priority color tokens (globals.css)', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
  const darkBlock = css.slice(
    css.indexOf('.dark {'),
    css.indexOf('@theme inline')
  )

  it.each(['priority-high', 'priority-medium', 'priority-low'])(
    '.dark redefines --%s (brighter on the dark background)',
    token => {
      expect(darkBlock).toMatch(new RegExp(`--${token}:\\s*oklch\\(`))
    }
  )

  it('--priority-urgent has no .dark override (red passes both modes)', () => {
    expect(darkBlock).not.toMatch(/--priority-urgent:/)
  })
})

// LUM-258: callout variants are token-driven; the duplicated .dark callout
// palette is gone (subtle/border are translucent and adapt on their own).
describe('callout variants are token-driven', () => {
  it('has no .dark .callout[data-variant] rules', () => {
    expect(css).not.toMatch(/\.dark\s+\.callout\[data-variant/)
  })

  it.each([
    ['info', 'info'],
    ['warning', 'warning'],
    ['success', 'success'],
    ['error', 'danger'], // error variant maps to the danger token family
  ])(
    'callout[data-variant=%s] drives border-left from var(--%s)',
    (variant, token) => {
      const rule =
        css.match(
          new RegExp(`\\.callout\\[data-variant='${variant}'\\]\\s*\\{[^}]*\\}`)
        )?.[0] ?? ''
      expect(rule).toContain(`background-color: var(--${token}-subtle)`)
      expect(rule).toContain(`border-color: var(--${token}-border)`)
      expect(rule).toContain(`border-left-color: var(--${token})`)
    }
  )
})
