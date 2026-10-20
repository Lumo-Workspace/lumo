/**
 * Tag colours — the single helper every tag renderer uses (document badges,
 * the tag picker, task-timeline tag chips, the Tags settings list).
 *
 * A tag's colour is payload (stored on the tag / hashed from its name and
 * written into inline styles), not a CSS token, so the raw hex IS the data.
 * This module is allowlisted in scripts/lint-tokens.ts; keep raw colours and
 * the colour maths confined here.
 *
 * Readability (LUM-1276): every chip gets a light AND a dark rendering whose
 * label clears WCAG AA (4.5:1) against the chip's own background. The dark
 * rendering is derived at runtime in OKLCH from the same base colour — same
 * hue, lighter label, darker chip — so arbitrary user-picked hex stays legible
 * on the dark page without storing a second colour. Both variants are emitted
 * as CSS variables and switched by the `dark:` variant (see TAG_CHIP_CLASS),
 * so the theme is never read in JS during render.
 */
import type { CSSProperties } from 'react'

export interface TagColor {
  bg: string
  text: string
}

export interface TagColorScheme {
  light: TagColor
  dark: TagColor
}

/** Hash palette for display-only legacy string tags (TagBadge). */
export const TAG_BADGE_COLORS: TagColor[] = [
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#dcfce7', text: '#166534' },
  { bg: '#fef3c7', text: '#92400e' },
  { bg: '#e0e7ff', text: '#3730a3' },
  { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#ffedd5', text: '#9a3412' },
  { bg: '#ccfbf1', text: '#115e59' },
  { bg: '#fee2e2', text: '#991b1b' },
]

/**
 * Default palette for tags without an explicit colour (TagPicker) and for the
 * name-only tag chips in the task timeline.
 */
export const TAG_PICKER_COLORS: TagColor[] = [
  { bg: '#fff1f0', text: '#f5222d' }, // red
  { bg: '#fff7e6', text: '#fa8c16' }, // orange
  { bg: '#fffbe6', text: '#d4a012' }, // yellow
  { bg: '#f6ffed', text: '#52c41a' }, // green
  { bg: '#e6f7ff', text: '#1890ff' }, // blue
  { bg: '#f9f0ff', text: '#722ed1' }, // purple
]

/** WCAG AA for normal-size text — tag labels are caption-size. */
export const MIN_TAG_CONTRAST = 4.5

/** Share of a user colour mixed into white for its light chip background. */
const LIGHT_TINT = 0.125
/** OKLCH lightness / max chroma of the dark-theme chip background. */
const DARK_BG_L = 0.3
const DARK_BG_MAX_C = 0.07
/** Dark-theme labels start at least this light, then step up until AA. */
const DARK_FG_MIN_L = 0.72

type Rgb = [number, number, number]
type Oklch = [number, number, number]

// ── sRGB / hex ────────────────────────────────────────────────────────────

/** Parse `#rgb` or `#rrggbb` into 0..1 sRGB channels; null when malformed. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m?.[1]) return null
  const h =
    m[1].length === 3
      ? m[1]
          .split('')
          .map(c => c + c)
          .join('')
      : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map(v =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const fromLinear = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

/** WCAG 2 contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const rgb = parseHex(hex)
    if (!rgb) throw new Error(`invalid hex ${hex}`)
    const [r, g, bl] = rgb.map(toLinear) as Rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// ── OKLCH ─────────────────────────────────────────────────────────────────

function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363015264 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, B)
  const H = C < 1e-6 ? 0 : (Math.atan2(B, A) * 180) / Math.PI
  return [L, C, H]
}

/** OKLCH → linear-free sRGB (may fall outside 0..1 when out of gamut). */
function oklchToRgbRaw([L, C, H]: Oklch): Rgb {
  const hr = (H * Math.PI) / 180
  const A = C * Math.cos(hr)
  const B = C * Math.sin(hr)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear) as Rgb
}

const inGamut = (rgb: Rgb) => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)

/** OKLCH → hex, reducing chroma (keeping L and hue) until it fits sRGB. */
function oklchToHex([L, C, H]: Oklch): string {
  const raw = oklchToRgbRaw([L, C, H])
  if (inGamut(raw)) return toHex(raw)
  let lo = 0
  let hi = C
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(oklchToRgbRaw([L, mid, H]))) lo = mid
    else hi = mid
  }
  return toHex(oklchToRgbRaw([L, lo, H]))
}

/**
 * Move `fg`'s OKLCH lightness (hue/chroma kept) toward darker or lighter until
 * it clears MIN_TAG_CONTRAST against `bg`. Returns `fg` unchanged if it passes.
 */
function ensureContrast(
  fg: string,
  bg: string,
  direction: 'darker' | 'lighter'
): string {
  if (contrastRatio(fg, bg) >= MIN_TAG_CONTRAST) return fg
  const [L, C, H] = rgbToOklch(parseHex(fg)!)
  const step = direction === 'darker' ? -0.01 : 0.01
  for (let l = L + step; l >= 0 && l <= 1; l += step) {
    const hex = oklchToHex([l, C, H])
    if (contrastRatio(hex, bg) >= MIN_TAG_CONTRAST) return hex
  }
  return direction === 'darker' ? '#000000' : '#ffffff'
}

// ── Schemes ───────────────────────────────────────────────────────────────

/** Dark-theme chip: same hue, deep low-chroma background, light label. */
function deriveDark(base: string): TagColor {
  const [L, C, H] = rgbToOklch(parseHex(base)!)
  const bg = oklchToHex([DARK_BG_L, Math.min(C, DARK_BG_MAX_C), H])
  const start = oklchToHex([Math.max(L, DARK_FG_MIN_L), C, H])
  return { bg, text: ensureContrast(start, bg, 'lighter') }
}

/** Deterministic palette index for a tag name (char-code sum). */
export function hashTagName(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
}

/** Light + dark colours for one palette entry (light bg kept as designed). */
export function paletteScheme(entry: TagColor): TagColorScheme {
  return {
    light: {
      bg: entry.bg,
      text: ensureContrast(entry.text, entry.bg, 'darker'),
    },
    dark: deriveDark(entry.text),
  }
}

/** Light + dark colours for an arbitrary user-chosen hex; null if malformed. */
export function userColorScheme(color: string): TagColorScheme | null {
  const rgb = parseHex(color)
  if (!rgb) return null
  const base = toHex(rgb)
  const bg = toHex(rgb.map(v => 1 - LIGHT_TINT + LIGHT_TINT * v) as Rgb)
  return {
    light: { bg, text: ensureContrast(base, bg, 'darker') },
    dark: deriveDark(base),
  }
}

/**
 * Resolve a tag's colours: its stored colour when valid, else the palette
 * entry its name hashes to.
 */
export function tagColorScheme(
  tag: { name: string; color?: string | null },
  palette: TagColor[] = TAG_PICKER_COLORS
): TagColorScheme {
  const own = tag.color ? userColorScheme(tag.color) : null
  if (own) return own
  const entry = palette[hashTagName(tag.name) % palette.length] ?? palette[0]!
  return paletteScheme(entry)
}

/** Classes that paint a chip from the variables set by tagChipStyle. */
export const TAG_CHIP_CLASS =
  'bg-(--tag-bg) text-(--tag-fg) dark:bg-(--tag-bg-dark) dark:text-(--tag-fg-dark)'

/** Inline CSS variables carrying both theme variants of a tag's colours. */
export function tagChipStyle(scheme: TagColorScheme): CSSProperties {
  return {
    '--tag-bg': scheme.light.bg,
    '--tag-fg': scheme.light.text,
    '--tag-bg-dark': scheme.dark.bg,
    '--tag-fg-dark': scheme.dark.text,
  } as CSSProperties
}
