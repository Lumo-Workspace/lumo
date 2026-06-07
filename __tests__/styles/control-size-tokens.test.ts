import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-287: control size/density tiers carried as Tailwind v4 --spacing-* tokens
// in app/globals.css. Each tier MUST declare its height and inline-padding token
// so a tier cannot be silently dropped or renamed out from under the
// h-control-* / px-control-inset-* call sites in the atomic components.
const TIERS = ['sm', 'md', 'lg'] as const

describe('app/globals.css control size tokens', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

  it.each(TIERS)('declares --spacing-control-%s height with a rem value', (tier) => {
    expect(css).toMatch(new RegExp(`--spacing-control-${tier}:\\s*[\\d.]+rem;`))
  })

  it.each(TIERS)(
    'declares --spacing-control-inset-%s padding with a rem value',
    (tier) => {
      expect(css).toMatch(
        new RegExp(`--spacing-control-inset-${tier}:\\s*[\\d.]+rem;`)
      )
    }
  )
})
