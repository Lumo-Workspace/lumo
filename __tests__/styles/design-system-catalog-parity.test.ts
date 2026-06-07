import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CATALOG_COLOR_TOKENS } from '@/components/design-system/data/tokens'

// LUM-291: the /design-system catalog enumerates tokens in
// components/design-system/data/tokens.ts. This guard keeps that list in sync
// with globals.css so a newly-added color token can't silently be missing from
// the catalog (the whole point of the catalog is to show every token).
//
// Comments are stripped first so a `{`/`}` inside a CSS comment can't corrupt
// the scan (recurring globals.css guard-test hazard — LUM-261).
const css = readFileSync(
  join(__dirname, '../../app/globals.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

// `--color-brand` / `--color-light` are landing-fork brand tokens, scoped to
// `.landing` and not resolvable in the app context — intentionally not shown
// in the app design-system catalog.
const ALLOWLIST = new Set(['brand', 'light'])

/** Every `--color-<name>` registered in the `@theme inline` block. */
function themeColorTokens(): string[] {
  const at = css.indexOf('@theme inline')
  if (at === -1) throw new Error('no @theme inline block in globals.css')
  const body = css.slice(at)
  return [...body.matchAll(/--color-([a-z0-9-]+)\s*:/g)]
    .map(m => m[1] ?? '')
    .filter(name => !ALLOWLIST.has(name))
}

it('every globals.css --color-* token is in the catalog registry', () => {
  const catalog = new Set(CATALOG_COLOR_TOKENS)
  const missing = themeColorTokens().filter(name => !catalog.has(name))
  expect(missing).toEqual([])
})

it('the catalog registry has no token absent from globals.css', () => {
  const theme = new Set(themeColorTokens())
  const stray = CATALOG_COLOR_TOKENS.filter(name => !theme.has(name))
  expect(stray).toEqual([])
})
