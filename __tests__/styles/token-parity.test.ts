import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-286: a single guard that every base design token defined in `:root` is
// either redefined in `.dark` (a per-mode value) OR is an explicit, documented
// single-source exception. Before this, each token family had its own test
// asserting "defined in both blocks" for the handful of tokens it cared about
// (status-color-tokens, globals-css-color-tokens) — but nothing caught a NEW
// base token added to `:root` only. Such a token silently inherits its light
// value in dark mode (or vice-versa). This test fails the moment that happens,
// forcing an explicit decision: add the `.dark` override, or allowlist it here
// with a reason.

// Comments are stripped before parsing so a `{`/`}` or `@theme inline` literal
// inside a CSS comment can't corrupt the brace scan (a recurring globals.css
// guard-test hazard — LUM-261).
const css = readFileSync(
  join(__dirname, '../../app/globals.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

/** Body of the first `selector { … }` rule, brace-depth aware (not `[^}]*`). */
function blockBody(selector: string): string {
  const re = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{`)
  const m = css.match(re)
  if (m?.index == null) throw new Error(`could not find ${selector} block`)
  let depth = 1
  let i = m.index + m[0].length
  const start = i
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
  }
  return css.slice(start, i - 1)
}

/** Custom-property names declared directly in a block, in source order. */
function declaredTokens(body: string): string[] {
  return [...body.matchAll(/--([a-z0-9-]+)\s*:/g)].map(m => m[1] ?? '')
}

const rootTokens = declaredTokens(blockBody(':root'))
const darkTokens = new Set(declaredTokens(blockBody('.dark')))
const rootSet = new Set(rootTokens)

// Tokens intentionally defined ONCE in :root with no .dark override. Each entry
// must justify why a single value is correct in both colour schemes. Keep this
// list tight — a token that genuinely differs per mode does NOT belong here.
const SINGLE_SOURCE_ALLOWLIST: Record<string, string> = {
  // LUM-262: one brand-blue focus accent for the whole app, identical in both
  // modes; --ring / --sidebar-ring derive from --focus-ring via var().
  'focus-ring': 'single focus accent, identical light/dark (LUM-262)',
  ring: 'derives from var(--focus-ring) (LUM-262)',
  'sidebar-ring': 'derives from var(--focus-ring) (LUM-262)',
  // Geometry — not a colour, mode-independent by nature. (The font variables
  // are set by next/font on <html>, not declared here — LUM-1261.)
  radius: 'border-radius geometry, mode-independent',
  // LUM-258: feedback -foreground is a near-black text colour kept identical in
  // both modes (flipping to white would fail AA on the light accents); -subtle
  // / -border are translucent color-mix() of the accent that re-resolve over
  // --background automatically, so they need no per-mode override.
  'info-foreground': 'near-black on solid accent, both modes (LUM-258)',
  'info-subtle':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  'info-border':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  'warning-foreground': 'near-black on solid accent, both modes (LUM-258)',
  'warning-subtle':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  'warning-border':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  'success-foreground': 'near-black on solid accent, both modes (LUM-258)',
  'success-subtle':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  'success-border':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  'danger-foreground': 'near-black on solid accent, both modes (LUM-258)',
  'danger-subtle':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  'danger-border':
    'translucent color-mix, re-resolves over --background (LUM-258)',
  // LUM-620: subtle/border companions for the in-review magenta. Translucent
  // color-mix of --status-in-review (which HAS a .dark override), so one
  // definition re-resolves correctly over --background in both modes.
  'status-in-review-subtle':
    'translucent color-mix, re-resolves over --background (LUM-620)',
  'status-in-review-border':
    'translucent color-mix, re-resolves over --background (LUM-620)',
  // LUM-702: the four priority colours are a design-fixed brand palette shown
  // identically in light and dark — the per-mode split they used to carry is
  // gone on purpose. Contrast consequences are pinned in feedback-contrast.
  'priority-urgent': 'fixed brand palette, identical light/dark (LUM-702)',
  'priority-high': 'fixed brand palette, identical light/dark (LUM-702)',
  'priority-medium': 'fixed brand palette, identical light/dark (LUM-702)',
  'priority-low': 'fixed brand palette, identical light/dark (LUM-702)',
  // LUM-294: primitive neutral ramp — mode-independent raw grayscale seeds. The
  // semantic neutral tokens (background/card/muted/border/sidebar*/…) derive
  // from these via var(--gray-N) and keep their own per-mode overrides, so only
  // the ramp steps themselves are single-source.
  'gray-0': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-1': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-2': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-3': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-4': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-5': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-6': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-7': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-8': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-9': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-10':
    'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-11':
    'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-12':
    'primitive neutral ramp step, mode-independent raw value (LUM-294)',
}

describe('token :root ↔ .dark parity', () => {
  it('parses a non-trivial set of base tokens from :root', () => {
    // Guards against the parser silently returning [] (which would make every
    // assertion below vacuously pass).
    expect(rootTokens.length).toBeGreaterThan(40)
  })

  it.each(rootTokens)(
    '--%s has a .dark override or is an allowlisted single source',
    token => {
      const ok = darkTokens.has(token) || token in SINGLE_SOURCE_ALLOWLIST
      // Custom message so a failure tells you the exact fix.
      expect(
        ok ||
          `--${token} is defined in :root but not .dark, and is not in ` +
            `SINGLE_SOURCE_ALLOWLIST. Add a .dark override, or allowlist it ` +
            `with a reason if one value is correct in both modes.`
      ).toBe(true)
    }
  )

  it('every .dark token also exists in :root (no orphan dark-only tokens)', () => {
    const orphans = [...darkTokens].filter(t => !rootSet.has(t))
    expect(orphans).toEqual([])
  })
})

describe('SINGLE_SOURCE_ALLOWLIST hygiene', () => {
  // Keep the allowlist honest: an entry is only valid if the token is actually
  // declared in :root AND genuinely absent from .dark. This auto-flags dead
  // entries (token removed, or a .dark override later added) so the allowlist
  // can't rot into a list of stale rubber-stamps.
  it.each(Object.keys(SINGLE_SOURCE_ALLOWLIST))(
    'allowlisted --%s exists in :root and has no .dark override',
    token => {
      expect(rootSet.has(token)).toBe(true)
      expect(darkTokens.has(token)).toBe(false)
    }
  )

  it('every allowlist entry carries a non-empty reason', () => {
    for (const [token, reason] of Object.entries(SINGLE_SOURCE_ALLOWLIST)) {
      expect(reason.trim().length).toBeGreaterThan(0)
      expect(token).not.toMatch(/^--/) // store bare names, not the `--` prefix
    }
  })
})
