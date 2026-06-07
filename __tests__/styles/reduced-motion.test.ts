import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-289: prefers-reduced-motion vestibular-safety degradation. globals.css
// must ship a `@media (prefers-reduced-motion: reduce)` block that (a) collapses
// the LUM-284 motion tokens and (b) neutralizes animations/transitions globally.
//
// The reset uses a NEAR-ZERO duration (not `animation: none`) on purpose:
// entrance animations (.animate-appear / .animate-fade-in-up) start from
// opacity:0 and depend on the animation's `forwards` fill to become visible, so
// killing the animation outright would leave that content permanently hidden.
// A 0.01ms duration + a single iteration snaps them to their final visible
// state, stops infinite decorative loops after one frame, and makes transitions
// instant. These guards lock that contract in.
//
// NOTE: parses globals.css as raw text. Unlike the sibling @theme guards we
// can't use the `[^}]*` block grab here (the media query has nested braces), so
// we slice out the reduced-motion at-rule by brace-matching from its opening.

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

const AT_RULE = '@media (prefers-reduced-motion: reduce)'

function reducedMotionBlock(): string {
  const start = css.indexOf(AT_RULE)
  if (start === -1) throw new Error(`globals.css is missing "${AT_RULE}"`)
  // Walk braces from the at-rule's first `{` to its matching `}`.
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error('unterminated @media (prefers-reduced-motion: reduce) block')
}

describe('prefers-reduced-motion degradation (LUM-289)', () => {
  it('globals.css declares a prefers-reduced-motion: reduce media query', () => {
    expect(css).toContain(AT_RULE)
  })

  const block = reducedMotionBlock()

  it('collapses every LUM-284 transition-duration token to near-zero', () => {
    for (const tier of ['fast', 'base', 'slow']) {
      const m = block.match(
        new RegExp(`--transition-duration-${tier}:\\s*0(?:\\.0+)?(?:ms|s)?`)
      )
      expect(m).not.toBeNull()
    }
  })

  it('neutralizes animation-duration globally with !important', () => {
    expect(block).toMatch(/animation-duration:\s*0[.\d]*m?s\s*!important/)
  })

  it('caps animation-iteration-count to 1 so infinite loops stop', () => {
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/)
  })

  it('neutralizes transition-duration globally with !important', () => {
    expect(block).toMatch(/transition-duration:\s*0[.\d]*m?s\s*!important/)
  })

  it('applies the reset to a universal selector (pseudo-elements included)', () => {
    expect(block).toMatch(/\*::before/)
    expect(block).toMatch(/\*::after/)
  })
})
