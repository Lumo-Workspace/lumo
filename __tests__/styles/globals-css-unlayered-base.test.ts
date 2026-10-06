import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// LUM-1006: an unlayered `* { border-color }` in globals.css beat every
// `@layer utilities` class, so border-input / border-ring / border-transparent
// and every other border- and outline-colour utility silently never painted.
// Base defaults for `*` / `html` / `body` must live inside `@layer base`.

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

const GUARDED_SELECTOR = /(^|,)\s*(\*|html|body)(::?[\w-]+)?\s*(?=,|$)/
const UTILITY_PROPERTY =
  /(^|[;{\s])(border(-[a-z]+)?-color|outline-color|background-color|color)\s*:/

type Rule = { selector: string; body: string; layered: boolean }

// Minimal brace walker: tracks whether each rule sits inside an @layer block.
function rules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  const stack: { prelude: string; start: number }[] = []
  let preludeStart = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      stack.push({ prelude: text.slice(preludeStart, i).trim(), start: i + 1 })
      preludeStart = i + 1
    } else if (ch === '}') {
      const open = stack.pop()
      if (open && !open.prelude.startsWith('@')) {
        out.push({
          selector: open.prelude,
          body: text.slice(open.start, i),
          layered: stack.some(s => s.prelude.startsWith('@layer')),
        })
      }
      preludeStart = i + 1
    } else if (ch === ';' && stack.length === 0) {
      preludeStart = i + 1
    }
  }
  return out
}

describe('globals.css base defaults stay layered (LUM-1006)', () => {
  it('has no unlayered *, html or body rule that sets a colour utilities would set', () => {
    const offenders = rules(css)
      .filter(r => !r.layered)
      .filter(r => GUARDED_SELECTOR.test(r.selector))
      .filter(r => UTILITY_PROPERTY.test(r.body))
      .map(r => `${r.selector} { ${r.body.trim().replace(/\s+/g, ' ')} }`)
    expect(offenders).toEqual([])
  })

  it('keeps the layered border/outline defaults', () => {
    expect(css).toMatch(
      /@layer base\s*\{\s*\*\s*\{\s*@apply border-border outline-ring\/50;/
    )
  })
})

// With the override gone, border-input paints --input, which is pure white in
// light mode (it is a background token here). App primitives use border-border
// so their borders keep the look they had in production (LUM-1006 decision).
describe('app UI primitives do not use border-input (LUM-1006)', () => {
  const dir = join(__dirname, '../../components/ui')
  const files = readdirSync(dir).filter(f => f.endsWith('.tsx'))

  it.each(files)('%s', file => {
    const source = readFileSync(join(dir, file), 'utf8')
    expect(source).not.toMatch(/(^|[^\w-])border-input(?![\w/-])/)
  })
})
