import { writeFileSync } from 'node:fs'

import {
  MIN_TAG_CONTRAST,
  TAG_BADGE_COLORS,
  TAG_CHIP_CLASS,
  TAG_PICKER_COLORS,
  contrastRatio,
  hashTagName,
  parseHex,
  paletteScheme,
  tagChipStyle,
  tagColorScheme,
  userColorScheme,
  type TagColor,
  type TagColorScheme,
} from '@/app/workspace/[workspaceUrl]/components/document/tag-colors'

// LUM-1276: every tag chip label must clear WCAG AA (4.5:1) against its own
// chip background in BOTH themes — for every hash-palette entry and for
// arbitrary user-picked colours.

const SAMPLE_USER_COLORS: Record<string, string> = {
  'pure blue': '#0000ff',
  navy: '#1e3a8a',
  yellow: '#facc15',
  white: '#ffffff',
  black: '#000000',
  'preset red': '#f5222d',
  'preset orange': '#fa8c16',
  'preset yellow': '#d4a012',
  'preset green': '#52c41a',
  'preset blue': '#1890ff',
  'preset purple': '#722ed1',
  'short hex': '#00f',
}

type Case = { label: string; scheme: TagColorScheme; legacy: TagColorScheme }

/** Page background in dark mode (--gray-12 ≈ #0a0a0a). */
const DARK_PAGE = '#0a0a0a'
/** Pre-LUM-1276 user-colour chip: `${color}20` (12.5% alpha) over the page. */
function legacyAlphaChip(color: string, page: string): TagColor {
  const c = parseHex(color)!
  const p = parseHex(page)!
  const a = 0x20 / 255
  const mix = c.map((v, i) => Math.round((a * v + (1 - a) * p[i]!) * 255))
  return {
    bg: `#${mix.map(v => v.toString(16).padStart(2, '0')).join('')}`,
    text: color,
  }
}

const cases: Case[] = [
  ...TAG_PICKER_COLORS.map((e, i) => ({
    label: `picker palette #${i} (${e.text})`,
    scheme: paletteScheme(e),
    // Fixed light pair rendered unchanged in both themes.
    legacy: { light: e, dark: e },
  })),
  ...TAG_BADGE_COLORS.map((e, i) => ({
    label: `badge palette #${i} (${e.text})`,
    scheme: paletteScheme(e),
    legacy: { light: e, dark: e },
  })),
  ...Object.entries(SAMPLE_USER_COLORS).map(([name, hex]) => ({
    label: `user ${name} (${hex})`,
    scheme: userColorScheme(hex)!,
    legacy: {
      light: legacyAlphaChip(hex, '#ffffff'),
      dark: legacyAlphaChip(hex, DARK_PAGE),
    },
  })),
]

const ratio = (c: TagColor) => contrastRatio(c.text, c.bg)

describe('tag colours — contrast (LUM-1276)', () => {
  it.each(cases)('$label clears AA in light and dark', ({ scheme }) => {
    expect(ratio(scheme.light)).toBeGreaterThanOrEqual(MIN_TAG_CONTRAST)
    expect(ratio(scheme.dark)).toBeGreaterThanOrEqual(MIN_TAG_CONTRAST)
  })

  it('the pre-fix rendering failed in dark for a dark blue user colour', () => {
    const navy = cases.find(c => c.label.startsWith('user navy'))!
    expect(ratio(navy.legacy.dark)).toBeLessThan(MIN_TAG_CONTRAST)
    expect(ratio(navy.scheme.dark)).toBeGreaterThanOrEqual(MIN_TAG_CONTRAST)
  })

  it('dark chips are dark and keep the base hue family', () => {
    const blue = userColorScheme('#0000ff')!
    // Chip background darker than its label; label is light.
    expect(contrastRatio(blue.dark.bg, '#000000')).toBeLessThan(
      contrastRatio(blue.dark.text, '#000000')
    )
    const [r, g, b] = parseHex(blue.dark.text)!
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })

  it('writes the contrast table when TAG_CONTRAST_OUT is set', () => {
    const out = process.env.TAG_CONTRAST_OUT
    if (!out) return
    const f = (n: number) => n.toFixed(2)
    const rows = cases.map(
      c =>
        `| ${c.label} | ${f(ratio(c.legacy.light))} | ${f(ratio(c.legacy.dark))} | ${c.scheme.light.text} on ${c.scheme.light.bg} | ${f(ratio(c.scheme.light))} | ${c.scheme.dark.text} on ${c.scheme.dark.bg} | ${f(ratio(c.scheme.dark))} |`
    )
    const min = (sel: (c: Case) => number) => f(Math.min(...cases.map(sel)))
    writeFileSync(
      out,
      [
        '# LUM-1276 tag contrast (text vs own chip background, WCAG)',
        '',
        `Min before: light ${min(c => ratio(c.legacy.light))} / dark ${min(c => ratio(c.legacy.dark))} · Min after: light ${min(c => ratio(c.scheme.light))} / dark ${min(c => ratio(c.scheme.dark))}`,
        '',
        '| Colour | Before light | Before dark | After light (fg on bg) | After light | After dark (fg on bg) | After dark |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows,
        '',
      ].join('\n')
    )
  })
})

describe('tagColorScheme', () => {
  it('uses the stored colour when valid', () => {
    expect(tagColorScheme({ name: 'x', color: '#1e3a8a' })).toEqual(
      userColorScheme('#1e3a8a')
    )
  })

  it('falls back to the hashed palette for null or malformed colours', () => {
    const expected = paletteScheme(
      TAG_PICKER_COLORS[hashTagName('frontend') % TAG_PICKER_COLORS.length]!
    )
    expect(tagColorScheme({ name: 'frontend', color: null })).toEqual(expected)
    expect(tagColorScheme({ name: 'frontend', color: '#12' })).toEqual(expected)
  })

  it('honours an explicit palette', () => {
    expect(tagColorScheme({ name: 'frontend' }, TAG_BADGE_COLORS)).toEqual(
      paletteScheme(TAG_BADGE_COLORS[hashTagName('frontend') % 8]!)
    )
  })

  it('keeps the designed light palette pair when it already passes', () => {
    expect(paletteScheme(TAG_BADGE_COLORS[0]!).light).toEqual(
      TAG_BADGE_COLORS[0]
    )
  })
})

describe('tagChipStyle', () => {
  it('emits both theme variants as CSS variables consumed by TAG_CHIP_CLASS', () => {
    const scheme = userColorScheme('#0000ff')!
    expect(tagChipStyle(scheme)).toEqual({
      '--tag-bg': scheme.light.bg,
      '--tag-fg': scheme.light.text,
      '--tag-bg-dark': scheme.dark.bg,
      '--tag-fg-dark': scheme.dark.text,
    })
    for (const v of ['--tag-bg', '--tag-fg', '--tag-bg-dark', '--tag-fg-dark'])
      expect(TAG_CHIP_CLASS).toContain(`(${v})`)
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })
})
