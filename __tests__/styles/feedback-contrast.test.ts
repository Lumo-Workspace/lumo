import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CATEGORY_STYLE } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/categorize'
import { MEMORY_CATEGORY_SPECS } from '@/app/workspace/[workspaceUrl]/components/memory/forms/fieldSpecs'
import {
  DELIVERY_DOT,
  HEALTH_DOT,
} from '@/app/workspace/[workspaceUrl]/components/milestones/milestoneDisplay'

// LUM-286: globals.css documents the WCAG contrast of every feedback / status /
// priority colour in a trailing comment (`3.3:1 on #fff`, `AA-verified`, …) but
// nothing *computed* those numbers — a comment can lie, and an oklch tweak can
// silently regress contrast while the comment stays put. (It already had: the
// --priority-medium comment claimed ~3.1:1 when the value measured 2.93:1.)
//
// This test derives contrast from the actual oklch token values via a
// self-contained oklch → linear-sRGB → WCAG-luminance pipeline (no new deps;
// pure, deterministic — jest-friendly). Thresholds are tiered by how the token
// is used, matching the design intent already written into globals.css:
//   • feedback `-foreground` is body text on a solid accent fill → AA text 4.5:1
//   • status / priority render as small dots, strokes and chips → WCAG
//     non-text "graphical object" 3:1
//
// Both backgrounds are checked per mode (light = --background :root, dark =
// --background .dark), so a regression in either scheme is caught.

const TEXT_AA = 4.5
const GRAPHICS = 3.0

const css = readFileSync(
  join(__dirname, '../../app/globals.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

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

const ROOT = blockBody(':root')
const DARK = blockBody('.dark')

/** Raw value of a custom property within a block, whitespace-collapsed. */
function rawValue(block: string, token: string): string | null {
  const m = block.match(new RegExp(`--${token}\\s*:\\s*([^;]+);`))
  return m?.[1] ? m[1].replace(/\s+/g, ' ').trim() : null
}

type Mode = 'light' | 'dark'

/**
 * Resolve a token to its value in a mode: .dark override if present, else :root.
 * LUM-294: neutral tokens (e.g. --background) now derive from the primitive
 * --gray-* ramp, so follow var() indirection recursively until an oklch literal
 * is reached (today neutral tokens point one level deep at the :root-only,
 * mode-independent --gray-* ramp).
 */
function resolve(token: string, mode: Mode): string {
  const value =
    mode === 'dark'
      ? (rawValue(DARK, token) ?? rawValue(ROOT, token))
      : rawValue(ROOT, token)
  if (value == null) throw new Error(`token --${token} not defined`)
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/)
  if (ref?.[1]) return resolve(ref[1], mode)
  return value
}

/** Parse `oklch(L C H)` (L in 0..1, C, H in degrees) → [L, C, H]. */
function parseOklch(value: string): [number, number, number] {
  const m = value.match(/oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/)
  if (!m) throw new Error(`not a plain oklch() value: ${value}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * oklch → linear-light sRGB (Björn Ottosson's OKLab matrices), components
 * clamped to [0, 1]. We keep the *linear* RGB because WCAG relative luminance
 * is defined on linear-light channels — no need to round-trip through gamma.
 */
function oklchToLinearRgb(value: string): [number, number, number] {
  const [L, C, H] = parseOklch(value)
  const hr = (H * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const rgb: [number, number, number] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return rgb.map(x => Math.min(1, Math.max(0, x))) as [number, number, number]
}

/** oklch → `#rrggbb`, gamma-encoding the linear channels back to sRGB. */
function oklchToHex(value: string): string {
  return (
    '#' +
    oklchToLinearRgb(value)
      .map(c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055))
      .map(c =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

/** WCAG relative luminance from linear-light sRGB. */
function relativeLuminance(value: string): number {
  const [r, g, b] = oklchToLinearRgb(value)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two oklch token values (order-independent). */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// ── Sanity-check the colour pipeline against known anchors ──────────────────
// Pure white vs pure black is exactly 21:1; this pins the maths so a broken
// matrix can't make every real assertion pass with garbage ratios.
describe('oklch contrast pipeline', () => {
  it('white vs black is 21:1', () => {
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 1)
  })

  it('a colour has 1:1 contrast with itself', () => {
    expect(
      contrastRatio('oklch(0.62 0.2 25)', 'oklch(0.62 0.2 25)')
    ).toBeCloseTo(1, 5)
  })
})

// ── Feedback foreground text on its solid accent fill (AA text 4.5:1) ───────
const FEEDBACK = ['info', 'warning', 'success', 'danger'] as const

describe('feedback -foreground meets AA text contrast on its accent', () => {
  it.each(FEEDBACK)('--%s-foreground vs --%s (light + dark)', family => {
    const fg = resolve(`${family}-foreground`, 'light') // single-source, both modes
    const light = contrastRatio(fg, resolve(family, 'light'))
    const dark = contrastRatio(fg, resolve(family, 'dark'))
    expect(light).toBeGreaterThanOrEqual(TEXT_AA)
    expect(dark).toBeGreaterThanOrEqual(TEXT_AA)
  })
})

// ── Feedback -text on the page background (AA text 4.5:1, LUM-934) ──────────
// -text exists because the light accent fails AA as text on white; pin both
// halves of that rationale so the token can't drift back to the accent value.
// LUM-969 adds success / info / status-in-review.
const FEEDBACK_TEXT = [
  'warning',
  'danger',
  'success',
  'info',
  'status-in-review',
] as const

describe('feedback -text meets AA text contrast on --background', () => {
  it.each(FEEDBACK_TEXT)('--%s-text vs --background (light + dark)', family => {
    const light = contrastRatio(
      resolve(`${family}-text`, 'light'),
      resolve('background', 'light')
    )
    const dark = contrastRatio(
      resolve(`${family}-text`, 'dark'),
      resolve('background', 'dark')
    )
    expect(light).toBeGreaterThanOrEqual(TEXT_AA)
    expect(dark).toBeGreaterThanOrEqual(TEXT_AA)
  })

  it.each(FEEDBACK_TEXT)(
    'the light --%s accent alone would miss AA as text (why -text exists)',
    family => {
      expect(
        contrastRatio(resolve(family, 'light'), resolve('background', 'light'))
      ).toBeLessThan(TEXT_AA)
    }
  )

  // in-review is the exception (LUM-968): see the dark in-review block below.
  it.each(['warning', 'danger', 'success', 'info'] as const)(
    '--%s-text reuses the bright accent in dark mode',
    family => {
      expect(resolve(`${family}-text`, 'dark')).toBe(resolve(family, 'dark'))
    }
  )

  it('light values are the Tailwind amber-700 / red-700 steps', () => {
    expect(oklchToHex(resolve('warning-text', 'light'))).toBe('#bb4d00')
    // LUM-968: red-600 (e7000b) measured ~4.2:1 on danger-subtle; red-700.
    expect(oklchToHex(resolve('danger-text', 'light'))).toBe('#c10007')
  })

  it('LUM-969 light values: green-700, blue-600, deeper in-review magenta', () => {
    expect(oklchToHex(resolve('success-text', 'light'))).toBe('#008236')
    expect(oklchToHex(resolve('info-text', 'light'))).toBe('#155dfc')
    expect(oklchToHex(resolve('status-in-review-text', 'light'))).toBe(
      '#a125d7'
    )
  })
})

// ── -text on its own -subtle fill (AA text 4.5:1, LUM-969) ──────────────────
// Chips print -text on the family -subtle fill, a translucent color-mix of the
// accent. Composite that fill over --background (sRGB, like the browser) and
// measure the text against the result.

/** oklch → gamma-encoded sRGB channels in 0..1. */
function oklchToSrgb(value: string): [number, number, number] {
  return oklchToLinearRgb(value).map(c =>
    c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  ) as [number, number, number]
}

function srgbLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function srgbContrast(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const la = srgbLuminance(a)
  const lb = srgbLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `<accent>` at `alpha` over --background in `mode`, as sRGB. */
function overBackground(
  accentToken: string,
  alpha: number,
  mode: Mode
): [number, number, number] {
  const fg = oklchToSrgb(resolve(accentToken, mode))
  const bg = oklchToSrgb(resolve('background', mode))
  return fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]!) as [
    number,
    number,
    number,
  ]
}

/** Parse `color-mix(in srgb, var(--x) N%, transparent)` → [x, N / 100]. */
function subtleMix(family: string): [string, number] {
  const raw = rawValue(ROOT, `${family}-subtle`)
  const m = raw?.match(
    /^color-mix\(\s*in srgb,\s*var\(--([a-z0-9-]+)\)\s+([0-9.]+)%,\s*transparent\s*\)$/
  )
  if (!m?.[1] || !m[2]) throw new Error(`unexpected --${family}-subtle: ${raw}`)
  return [m[1], Number(m[2]) / 100]
}

function textOnSubtle(family: string, mode: Mode): number {
  const [accent, alpha] = subtleMix(family)
  return srgbContrast(
    oklchToSrgb(resolve(`${family}-text`, mode)),
    overBackground(accent, alpha, mode)
  )
}

// LUM-968: every family, both modes — danger (red-700) and dark in-review
// (lighter same-hue magenta) were the last two gaps.
describe('feedback -text meets AA on its own -subtle fill', () => {
  it.each(FEEDBACK_TEXT)('-text on its -subtle fill: %s (light)', family => {
    expect(textOnSubtle(family, 'light')).toBeGreaterThanOrEqual(TEXT_AA)
  })

  it.each(FEEDBACK_TEXT)('-text on its -subtle fill: %s (dark)', family => {
    expect(textOnSubtle(family, 'dark')).toBeGreaterThanOrEqual(TEXT_AA)
  })

  it('every -text token clears AA on the page AND its subtle, both modes', () => {
    const misses: string[] = []
    for (const family of FEEDBACK_TEXT) {
      for (const mode of ['light', 'dark'] as const) {
        const page = contrastRatio(
          resolve(`${family}-text`, mode),
          resolve('background', mode)
        )
        const subtle = textOnSubtle(family, mode)
        if (page < TEXT_AA || subtle < TEXT_AA)
          misses.push(
            `${family} ${mode}: ${page.toFixed(2)} / ${subtle.toFixed(2)}`
          )
      }
    }
    expect(misses).toEqual([])
  })

  it('LUM-968 pins the measured danger / in-review ratios', () => {
    const page = (family: string, mode: Mode) =>
      contrastRatio(
        resolve(`${family}-text`, mode),
        resolve('background', mode)
      )
    expect(page('danger', 'light')).toBeCloseTo(6.42, 1)
    expect(textOnSubtle('danger', 'light')).toBeCloseTo(5.64, 1)
    expect(page('status-in-review', 'dark')).toBeCloseTo(5.63, 1)
    expect(textOnSubtle('status-in-review', 'dark')).toBeCloseTo(5.27, 1)
  })

  it('the old red-600 danger text missed AA on danger-subtle', () => {
    // Regression anchor: red-600 measured ~4.2:1 on the 10% fill.
    const red600 = 'oklch(0.577 0.245 27.325)'
    expect(
      srgbContrast(oklchToSrgb(red600), overBackground('danger', 0.1, 'light'))
    ).toBeLessThan(TEXT_AA)
  })

  it('dark in-review text is a lighter step of the brand magenta hue', () => {
    // The bright accent alone lands at ~4.4:1 on its own 10% fill.
    expect(
      srgbContrast(
        oklchToSrgb(resolve('status-in-review', 'dark')),
        overBackground('status-in-review', 0.1, 'dark')
      )
    ).toBeLessThan(TEXT_AA)
    const [textL, , textH] = parseOklch(
      resolve('status-in-review-text', 'dark')
    )
    const [accentL, , accentH] = parseOklch(resolve('status-in-review', 'dark'))
    expect(textH).toBe(accentH)
    expect(textL).toBeGreaterThan(accentL)
    expect(oklchToHex(resolve('status-in-review-text', 'dark'))).toBe('#c452fd')
    // light keeps the deeper LUM-969 magenta
    expect(oklchToHex(resolve('status-in-review-text', 'light'))).toBe(
      '#a125d7'
    )
  })

  it('compositing pins the light accent-on-subtle failure it fixes', () => {
    // e.g. the old text-success on bg-success-subtle chip was ~2.1:1.
    expect(
      srgbContrast(
        oklchToSrgb(resolve('success', 'light')),
        overBackground('success', 0.1, 'light')
      )
    ).toBeLessThan(3)
  })
})

// ── Bare accents that remain on icons / strokes (non-text 3:1, LUM-969) ─────
// feedback-text-usage.test.ts allows bare text-<accent> only on audited icon
// sites. Those accents must clear the graphics threshold in both modes;
// success / warning do not on light, so their icons use the -text step.
const ICON_ACCENTS = [
  'danger',
  'destructive',
  'info',
  'status-in-review',
] as const

describe('accents kept on icons meet non-text 3:1', () => {
  it.each(ICON_ACCENTS)('--%s vs --background (light + dark)', token => {
    expect(
      contrastRatio(resolve(token, 'light'), resolve('background', 'light'))
    ).toBeGreaterThanOrEqual(GRAPHICS)
    expect(
      contrastRatio(resolve(token, 'dark'), resolve('background', 'dark'))
    ).toBeGreaterThanOrEqual(GRAPHICS)
  })

  it('--destructive icon on its 10% tile (light) and 20% tile (dark)', () => {
    const icon = (mode: Mode) => oklchToSrgb(resolve('destructive', mode))
    expect(
      srgbContrast(icon('light'), overBackground('destructive', 0.1, 'light'))
    ).toBeGreaterThanOrEqual(GRAPHICS)
    expect(
      srgbContrast(icon('dark'), overBackground('destructive', 0.2, 'dark'))
    ).toBeGreaterThanOrEqual(GRAPHICS)
  })

  it.each(['success', 'warning'] as const)(
    'the light --%s accent misses 3:1, so its icons cannot keep it',
    token => {
      expect(
        contrastRatio(resolve(token, 'light'), resolve('background', 'light'))
      ).toBeLessThan(GRAPHICS)
    }
  )

  it.each(['success', 'warning'] as const)(
    '--%s-text as an icon colour clears 3:1 on the page and its subtle',
    family => {
      for (const mode of ['light', 'dark'] as const) {
        expect(
          contrastRatio(
            resolve(`${family}-text`, mode),
            resolve('background', mode)
          )
        ).toBeGreaterThanOrEqual(GRAPHICS)
        expect(textOnSubtle(family, mode)).toBeGreaterThanOrEqual(GRAPHICS)
      }
    }
  )
})

// ── Chart marks and status dots (non-text 3:1, LUM-968) ─────────────────────
// CurrentSprintCard's burndown sparkline (line + end dot) sits on --card, and
// MilestoneHero's "health unavailable" dot sits on --background. The light
// success / warning accents miss 3:1 there, so both use the -text step.
describe('feedback chart marks meet non-text 3:1 on their surface', () => {
  const MARKS = [
    { family: 'success', surface: 'card', where: 'burndown sparkline' },
    { family: 'warning', surface: 'background', where: 'milestone hero dot' },
  ] as const

  it.each(MARKS)('$where: --$family-text on --$surface (light + dark)', m => {
    for (const mode of ['light', 'dark'] as const) {
      expect(
        contrastRatio(
          resolve(`${m.family}-text`, mode),
          resolve(m.surface, mode)
        )
      ).toBeGreaterThanOrEqual(GRAPHICS)
    }
  })

  it.each(MARKS)('$where: the bare --$family accent misses 3:1 on light', m => {
    expect(
      contrastRatio(resolve(m.family, 'light'), resolve(m.surface, 'light'))
    ).toBeLessThan(GRAPHICS)
  })
})

// ── Feedback dots, bars and strips on their real surfaces (LUM-968) ───────
// WCAG 1.4.11: each feedback graphic vs the surface it sits on, both modes.
// A surface is a token (card / background / muted / primary) or a family's
// -subtle fill composited over --card (chips, pills, the sprint bar).
type Surface = string | { subtle: string }

function surfaceSrgb(surface: Surface, mode: Mode): [number, number, number] {
  if (typeof surface === 'string') return oklchToSrgb(resolve(surface, mode))
  const [accent, alpha] = subtleMix(surface.subtle)
  const fg = oklchToSrgb(resolve(accent, mode))
  const bg = oklchToSrgb(resolve('card', mode))
  return fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]!) as [
    number,
    number,
    number,
  ]
}

function markRatio(token: string, surface: Surface, mode: Mode): number {
  return srgbContrast(
    oklchToSrgb(resolve(token, mode)),
    surfaceSrgb(surface, mode)
  )
}

const GRAPHIC_SITES: Array<{ where: string; token: string; on: Surface[] }> = [
  {
    where: 'SprintTimeline active dot / legend',
    token: 'success-text',
    on: ['card', 'background'],
  },
  {
    where: 'SprintTimeline progress strip',
    token: 'success-text',
    on: [{ subtle: 'success' }],
  },
  { where: 'SprintsBoard 100% bar', token: 'success-text', on: ['muted'] },
  {
    where: 'CurrentSprintCard completion fill',
    token: 'success-text',
    on: ['muted'],
  },
  {
    where: 'CurrentSprintCard Active chip dot',
    token: 'success-text',
    on: [{ subtle: 'success' }],
  },
  {
    where: 'CurrentSprintCard elapsed-time tick',
    token: 'muted-foreground',
    on: ['card', 'muted'],
  },
  {
    where: 'ProjectHealthRow warning dot',
    token: 'warning-text',
    on: [{ subtle: 'warning' }],
  },
  {
    where: 'ProjectHealthRow danger dot',
    token: 'danger',
    on: [{ subtle: 'danger' }],
  },
  { where: 'RangeBand warning dot', token: 'warning-text', on: ['muted'] },
  { where: 'RangeBand info dot', token: 'info', on: ['muted'] },
  { where: 'MilestoneRow complete bar', token: 'success-text', on: ['muted'] },
  { where: 'MilestoneRow active bar', token: 'info', on: ['muted'] },
  {
    where: 'IntegrationCard connected dot',
    token: 'success-text',
    on: ['card'],
  },
  {
    where: 'ProgressView agent-running dot',
    token: 'info',
    on: [{ subtle: 'info' }],
  },
  { where: 'MemoryCard category dots', token: 'success-text', on: ['card'] },
  { where: 'MemoryCard category dots', token: 'warning-text', on: ['card'] },
  { where: 'MemoryCard category dots', token: 'danger', on: ['card'] },
  { where: 'MemoryCard category dots', token: 'info', on: ['card'] },
]

describe('LUM-968 feedback graphics meet non-text 3:1 on their surface', () => {
  it.each(GRAPHIC_SITES)('$where: --$token (light + dark)', site => {
    for (const mode of ['light', 'dark'] as const)
      for (const surface of site.on)
        expect(markRatio(site.token, surface, mode)).toBeGreaterThanOrEqual(
          GRAPHICS
        )
  })

  it('the bare light success / warning accents miss 3:1 on those surfaces', () => {
    expect(markRatio('success', 'muted', 'light')).toBeLessThan(GRAPHICS)
    expect(markRatio('success', { subtle: 'success' }, 'light')).toBeLessThan(
      GRAPHICS
    )
    expect(markRatio('warning', 'muted', 'light')).toBeLessThan(GRAPHICS)
    expect(markRatio('warning', { subtle: 'warning' }, 'light')).toBeLessThan(
      GRAPHICS
    )
  })

  it('SprintTimeline label keeps AA on the bar; the old 35% fill broke it', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(
        markRatio('success-text', { subtle: 'success' }, mode)
      ).toBeGreaterThanOrEqual(TEXT_AA)
      // label over success/35 on top of the subtle bar (the removed fill)
      const bar = surfaceSrgb({ subtle: 'success' }, mode)
      const fill = oklchToSrgb(resolve('success', mode)).map(
        (c, i) => 0.35 * c + 0.65 * bar[i]!
      ) as [number, number, number]
      expect(
        srgbContrast(oklchToSrgb(resolve('success-text', mode)), fill)
      ).toBeLessThan(TEXT_AA)
    }
  })

  it('memory pills: dots clear 3:1 on the unselected pill; the selected pill rings them', () => {
    for (const spec of Object.values(MEMORY_CATEGORY_SPECS)) {
      const token = spec.dot.replace(/^bg-/, '')
      for (const mode of ['light', 'dark'] as const)
        expect(markRatio(token, 'muted', mode)).toBeGreaterThanOrEqual(GRAPHICS)
    }
    for (const mode of ['light', 'dark'] as const)
      expect(
        markRatio('primary-foreground', 'primary', mode)
      ).toBeGreaterThanOrEqual(GRAPHICS)
  })

  it('milestone health / delivery dots are semantic tokens at 3:1', () => {
    for (const cls of [
      ...Object.values(HEALTH_DOT),
      ...Object.values(DELIVERY_DOT),
    ]) {
      expect(cls).toMatch(/^bg-(success|warning|danger|info)(-text)?$/)
      const token = cls.replace(/^bg-/, '')
      for (const mode of ['light', 'dark'] as const)
        for (const surface of ['card', 'background'])
          expect(markRatio(token, surface, mode)).toBeGreaterThanOrEqual(
            GRAPHICS
          )
    }
  })

  it('agent-run failure / permission dots use the semantic tokens', () => {
    expect(CATEGORY_STYLE.tool_failure.dot).toBe('bg-danger')
    expect(CATEGORY_STYLE.turn_failure.dot).toBe('bg-danger')
    expect(CATEGORY_STYLE.permission_pause.dot).toBe('bg-warning-text')
  })
})

// ── destructive text uses --danger-text (LUM-969) ────────────────────────────
describe('destructive shares the danger red', () => {
  it('light --destructive and --danger are the same #ef4444', () => {
    expect(oklchToHex(resolve('destructive', 'light'))).toBe('#ef4444')
    expect(oklchToHex(resolve('danger', 'light'))).toBe('#ef4444')
  })

  it('--danger-text beats --destructive as text on both backgrounds', () => {
    for (const mode of ['light', 'dark'] as const) {
      const bg = resolve('background', mode)
      expect(contrastRatio(resolve('danger-text', mode), bg)).toBeGreaterThan(
        contrastRatio(resolve('destructive', mode), bg)
      )
      expect(
        contrastRatio(resolve('danger-text', mode), bg)
      ).toBeGreaterThanOrEqual(TEXT_AA)
    }
  })
})

// ── Status tokens as graphical objects on the page background (3:1) ─────────
const GRAPHIC_TOKENS = [
  'status-todo',
  'status-in-progress',
  'status-in-review',
  'status-done',
  // Data-viz categorical palette (LUM-290) — rendered as bars/lines/segments.
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
] as const

describe('status tokens meet 3:1 graphics contrast on --background', () => {
  it.each(GRAPHIC_TOKENS)('--%s vs --background (light + dark)', token => {
    const light = contrastRatio(
      resolve(token, 'light'),
      resolve('background', 'light')
    )
    const dark = contrastRatio(
      resolve(token, 'dark'),
      resolve('background', 'dark')
    )
    expect(light).toBeGreaterThanOrEqual(GRAPHICS)
    expect(dark).toBeGreaterThanOrEqual(GRAPHICS)
  })
})

// ── Priority: a fixed brand palette, measured but NOT held to 3:1 (LUM-702) ──
// The four priority colours are design-mandated and identical in both modes,
// which puts high/medium/low below the WCAG 1.4.11 graphics threshold on the
// light background. That is an accepted product decision, so asserting 3:1 here
// would be a standing red build. What this file still owes the codebase is that
// the trade-off stays VISIBLE and can't silently get worse: pin the measured
// ratios, so any future edit to a --priority-* value has to come back here and
// restate what it costs. Mitigation that makes it defensible: the dot is never
// the sole carrier — PriorityDot ships an aria-label and a tooltip, and the
// `label` variants print the priority as text.
const PRIORITY_RATIOS: Record<string, { light: number; dark: number }> = {
  'priority-urgent': { light: 4.68, dark: 4.23 }, // #dd2d2d — clears 3:1 in both
  'priority-high': { light: 2.68, dark: 7.38 }, // #ff752b — below 3:1 on light
  'priority-medium': { light: 1.35, dark: 14.64 }, // #ffdc2e — below 3:1 on light
  'priority-low': { light: 1.47, dark: 13.45 }, // #d1d5dc — below 3:1 on light
}

const BRAND_HEX: Record<string, string> = {
  'priority-urgent': '#dd2d2d',
  'priority-high': '#ff752b',
  'priority-medium': '#ffdc2e',
  'priority-low': '#d1d5dc',
}

describe('priority tokens are the brand palette', () => {
  it('every priority token resolves to its brand hex in both modes', () => {
    for (const [token, hex] of Object.entries(BRAND_HEX)) {
      expect(oklchToHex(resolve(token, 'light'))).toBe(hex)
      expect(oklchToHex(resolve(token, 'dark'))).toBe(hex)
    }
  })
})

describe('priority tokens keep their documented contrast (brand palette)', () => {
  it.each(Object.keys(PRIORITY_RATIOS))(
    '--%s measures the ratio globals.css documents',
    token => {
      const expected = PRIORITY_RATIOS[token]!
      const light = contrastRatio(
        resolve(token, 'light'),
        resolve('background', 'light')
      )
      const dark = contrastRatio(
        resolve(token, 'dark'),
        resolve('background', 'dark')
      )
      expect(light).toBeCloseTo(expected.light, 1)
      expect(dark).toBeCloseTo(expected.dark, 1)
    }
  )

  it('urgent is the one priority colour that clears 3:1 in both modes', () => {
    expect(
      contrastRatio(
        resolve('priority-urgent', 'light'),
        resolve('background', 'light')
      )
    ).toBeGreaterThanOrEqual(GRAPHICS)
    expect(
      contrastRatio(
        resolve('priority-urgent', 'dark'),
        resolve('background', 'dark')
      )
    ).toBeGreaterThanOrEqual(GRAPHICS)
  })
})
