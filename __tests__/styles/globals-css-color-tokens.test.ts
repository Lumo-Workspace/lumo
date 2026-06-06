import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// All design tokens in app/globals.css are defined as hex colors
// (e.g. `--primary: #1a1a1a`), NOT as bare HSL channel triples. So
// `hsl(var(--token) / alpha)` expands to `hsl(#1a1a1a / 0.12)`, which is
// invalid CSS — the whole declaration is dropped and nothing renders. This
// silently broke the document comment highlight and the table insert handles
// (LUM-240). Guard against the pattern regressing: use
// `color-mix(in srgb, var(--token) N%, transparent)` for alpha instead.
it('app/globals.css never wraps a hex token in hsl()/rgb()', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
  const offenders = css
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /(?:hsl|rgb)a?\(\s*var\(--/.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`)
  expect(offenders).toEqual([])
})
