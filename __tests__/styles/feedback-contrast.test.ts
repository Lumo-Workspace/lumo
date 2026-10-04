import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const FEEDBACK_TEXT = ['warning', 'danger'] as const

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

  it.each(FEEDBACK_TEXT)(
    '--%s-text reuses the bright accent in dark mode',
    family => {
      expect(resolve(`${family}-text`, 'dark')).toBe(resolve(family, 'dark'))
    }
  )

  it('light values are the Tailwind amber-700 / red-600 steps they replaced', () => {
    expect(oklchToHex(resolve('warning-text', 'light'))).toBe('#bb4d00')
    expect(oklchToHex(resolve('danger-text', 'light'))).toBe('#e7000b')
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
