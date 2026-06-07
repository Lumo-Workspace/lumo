import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-284: motion (transition duration + easing) has a single source of truth
// in the globals.css `@theme inline` block. duration-* utilities resolve named
// values from --transition-duration-*; ease-* from --ease-* (Tailwind v4 native
// namespaces). Guard that all five tokens exist with well-formed values so a
// refactor can't silently drop or rename them.
//
// NOTE: this file parses globals.css as raw text with a non-nesting `[^}]*`
// grab of the @theme block, exactly like the sibling color/typography guards.
// Keep the motion token COMMENT free of `{` `}` and the literal `@theme inline`
// or this and the other styles guards break (prior globals.css guard hazard).

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

function themeInlineBlock(): string {
  // First `{ … }` group after `@theme inline`. The block contains no nested
  // braces, so a non-greedy `[^}]*` is safe.
  const m = css.match(/@theme inline\s*\{([^}]*)\}/)
  if (!m?.[1]) throw new Error('could not find @theme inline block in globals.css')
  return m[1]
}

describe('motion tokens (LUM-284)', () => {
  const block = themeInlineBlock()

  it.each(['fast', 'base', 'slow'])(
    '--transition-duration-%s is registered as an ms value',
    (tier) => {
      const m = block.match(
        new RegExp(`--transition-duration-${tier}:\\s*(\\d+)ms`)
      )
      expect(m?.[1]).toBeDefined()
    }
  )

  it.each(['standard', 'emphasized'])(
    '--ease-%s is registered as a cubic-bezier curve',
    (name) => {
      const m = block.match(
        new RegExp(`--ease-${name}:\\s*cubic-bezier\\([^)]*\\)`)
      )
      expect(m).not.toBeNull()
    }
  )
})
