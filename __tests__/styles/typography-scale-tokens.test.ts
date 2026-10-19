import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-260: the semantic typography scale is carried by Tailwind v4 font-size
// tokens in app/globals.css. Each tier MUST declare its --text-{tier} size plus
// a --line-height (and the weighted/letter-spaced tiers their --font-weight /
// --letter-spacing companions). Guard against a tier being dropped or renamed,
// which would silently strip hierarchy from every migrated call site.
const TIERS = [
  'caption',
  'body',
  'body-strong',
  'title',
  'heading',
  'display',
] as const

describe('app/globals.css typography scale tokens', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

  it.each(TIERS)('declares --text-%s with a line-height companion', tier => {
    expect(css).toMatch(new RegExp(`--text-${tier}:\\s*[\\d.]+rem;`))
    expect(css).toMatch(new RegExp(`--text-${tier}--line-height:`))
  })

  it('declares a font-weight companion for the weighted tiers', () => {
    for (const tier of [
      'caption',
      'body',
      'body-strong',
      'title',
      'heading',
      'display',
    ]) {
      expect(css).toMatch(new RegExp(`--text-${tier}--font-weight:`))
    }
  })

  // LUM-1244 ruling: emphasized body matches shadcn's `font-medium` (buttons,
  // tabs, labels), so body-strong is 500, one step above body's 400.
  it('pins the body-strong weight to 500 (shadcn medium)', () => {
    expect(css).toMatch(/--text-body-strong--font-weight:\s*500;/)
    expect(css).toMatch(/--text-body--font-weight:\s*400;/)
  })
})
