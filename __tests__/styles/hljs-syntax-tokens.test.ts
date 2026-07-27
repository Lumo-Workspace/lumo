import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

// LUM-288: the highlight.js syntax palette is a categorical color set — one
// color per syntax category, mirroring GitHub's light/dark themes — not a
// semantic UI token. Like --priority-*, it's a sanctioned palette exception:
// the 14 GitHub hex values are lifted into named --hljs-* tokens (kept as hex
// so they stay legible against the upstream GitHub reference) and the .hljs-*
// rules consume them via var(). This guard keeps the palette named + paired
// per mode, and stops bare hex from creeping back into the rules (which is how
// it was previously hidden behind the whole-file lint-tokens allowlist).

const HLJS_TOKENS = [
  'comment',
  'keyword',
  'string',
  'number',
  'title',
  'attribute',
  'deletion',
] as const

// :root block and .dark block, sliced the same way the priority-token guard
// in globals-css-color-tokens.test.ts does. The `.hljs-*` *rules* live earlier
// in the file (before :root), so these slices only ever see token definitions.
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'))
const darkBlock = css.slice(
  css.indexOf('.dark {'),
  css.indexOf('@theme inline')
)

// The highlight.js rule region, bounded by its first selector and the next
// block (the callout styles).
const hljsRules = css.slice(
  css.indexOf('.hljs-comment'),
  css.indexOf('.callout {')
)

describe('hljs syntax palette tokens (LUM-288)', () => {
  it.each(HLJS_TOKENS)(':root defines --hljs-%s as a hex literal', t => {
    expect(rootBlock).toMatch(new RegExp(`--hljs-${t}:\\s*#[0-9a-fA-F]{3,8}`))
  })

  it.each(HLJS_TOKENS)('.dark redefines --hljs-%s as a hex literal', t => {
    expect(darkBlock).toMatch(new RegExp(`--hljs-${t}:\\s*#[0-9a-fA-F]{3,8}`))
  })

  it.each(HLJS_TOKENS)('the .hljs rules consume var(--hljs-%s)', t => {
    expect(hljsRules).toMatch(new RegExp(`color:\\s*var\\(--hljs-${t}\\)`))
  })

  it('no bare hex remains in the .hljs rule region', () => {
    const offenders = hljsRules
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b/.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`)
    expect(offenders).toEqual([])
  })
})
