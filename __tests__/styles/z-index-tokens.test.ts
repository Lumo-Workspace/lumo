import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-285: the semantic z-index scale is carried by Tailwind v4 --z-index-*
// tokens in app/globals.css @theme inline. The numeric ORDER is load-bearing:
// dropdown must sit above modal (in-dialog menus), modal above its overlay.
// Guard against a tier being dropped/renamed or the ordering being inverted.
const EXPECTED: ReadonlyArray<readonly [string, number]> = [
  ['base', 0],
  ['sticky', 10],
  ['overlay', 40],
  ['modal', 45],
  ['dropdown', 50],
  ['toast', 60],
  ['max', 9999],
]

describe('app/globals.css z-index scale tokens', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

  it.each(EXPECTED)('declares --z-index-%s with value %i', (tier, value) => {
    expect(css).toMatch(new RegExp(`--z-index-${tier}:\\s*${value};`))
  })

  it('keeps the tiers in strictly increasing numeric order', () => {
    const values = EXPECTED.map(([tier]) => {
      const m = css.match(new RegExp(`--z-index-${tier}:\\s*(\\d+);`))
      if (!m) throw new Error(`missing --z-index-${tier}`)
      return Number(m[1])
    })
    const sorted = [...values].sort((a, b) => a - b)
    expect(values).toEqual(sorted)
    expect(new Set(values).size).toBe(values.length) // no duplicate tiers
  })

  it('enforces the load-bearing dropdown > modal > overlay relationship', () => {
    const get = (tier: string) => {
      const m = css.match(new RegExp(`--z-index-${tier}:\\s*(\\d+);`))
      return Number(m?.[1])
    }
    expect(get('dropdown')).toBeGreaterThan(get('modal'))
    expect(get('modal')).toBeGreaterThan(get('overlay'))
  })
})
