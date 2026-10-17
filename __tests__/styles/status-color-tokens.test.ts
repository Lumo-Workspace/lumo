import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-259: task-status colors (TODO/IN_PROGRESS/IN_REVIEW/DONE) must come from
// the semantic --status-* tokens (single source of truth, also consumed by
// <StatusIcon> and .mention-task chips). Two guards:
//   1. globals.css defines all four tokens in BOTH :root and .dark, and the
//      low-contrast ones (todo grey, done green) actually diverge per mode so
//      both light and dark hit the WCAG 3:1 graphics threshold.
//   2. The chart/table status dots reference bg-status-* utilities, not
//      ad-hoc bg-zinc/blue/purple/green classes that drift from the palette.

const STATUS_TOKENS = [
  'status-todo',
  'status-in-progress',
  'status-in-review',
  'status-done',
] as const

function readGlobals(): string {
  return readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
}

/**
 * Extract the `--status-*` values from a single `:root {…}` / `.dark {…}` block.
 * Accepts both hex and `oklch(…)` — the app standardized on oklch in LUM-257,
 * so the values are `oklch(L C H)` with the hex kept only in a trailing comment.
 */
function statusValuesIn(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const token of STATUS_TOKENS) {
    const m = block.match(
      new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{3,8}|oklch\\([^)]*\\))`)
    )
    if (m?.[1]) out[token] = m[1].toLowerCase()
  }
  return out
}

function blockBody(css: string, selector: string): string {
  // First `{ … }` group following the selector at column 0.
  const re = new RegExp(
    `(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`
  )
  const m = css.match(re)
  if (!m?.[1])
    throw new Error(`could not find ${selector} block in globals.css`)
  return m[1]
}

describe('status color tokens (globals.css)', () => {
  const css = readGlobals()
  const root = statusValuesIn(blockBody(css, ':root'))
  const dark = statusValuesIn(blockBody(css, '.dark'))

  it('defines all four status tokens in :root and .dark', () => {
    for (const token of STATUS_TOKENS) {
      expect(root[token]).toMatch(/^(#[0-9a-f]{3,8}|oklch\([^)]*\))$/)
      expect(dark[token]).toMatch(/^(#[0-9a-f]{3,8}|oklch\([^)]*\))$/)
    }
  })

  it('diverges the low-contrast tokens (todo, done) between light and dark', () => {
    // todo grey is near-invisible on white; done green is too dark on white —
    // both must use a darker light-mode value and keep the bright dark-mode one.
    expect(root['status-todo']).not.toEqual(dark['status-todo'])
    expect(root['status-done']).not.toEqual(dark['status-done'])
  })
})

describe('status dots reference bg-status-* utilities', () => {
  const files = [
    '../../app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx',
  ]

  it.each(files)(
    '%s uses bg-status-* and no ad-hoc status color classes',
    file => {
      const src = readFileSync(join(__dirname, file), 'utf8')
      for (const token of STATUS_TOKENS) {
        expect(src).toContain(`bg-${token}`)
      }
      // The old per-status maps used these palette classes for the dots/bars.
      expect(src).not.toMatch(/\bbg-(blue|purple|green)-[0-9]/)
    }
  )
})
