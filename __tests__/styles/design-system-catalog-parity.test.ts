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

// `--color-brand` / `--color-light` are landing-fork brand tokens defined in
// components/landing/landing.css. globals.css @imports that file, but
// readFileSync does NOT follow @import, so these names don't appear in the
// scanned text today — this allowlist is prophylactic: it documents the
// exclusion intent and stays correct if the landing @theme block is ever
// inlined into globals.css.
const ALLOWLIST = new Set(['brand', 'light'])

/** Body of the `@theme inline { … }` block, brace-depth aware. */
function themeInlineBody(): string {
  const at = css.indexOf('@theme inline')
  if (at === -1) throw new Error('no @theme inline block in globals.css')
  const openBrace = css.indexOf('{', at)
  if (openBrace === -1)
    throw new Error('@theme inline block has no opening brace')
  let depth = 1
  let i = openBrace + 1
  const start = i
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
  }
  return css.slice(start, i - 1)
}

/** Every `--color-<name>` registered in the `@theme inline` block. */
function themeColorTokens(): string[] {
  const body = themeInlineBody()
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
