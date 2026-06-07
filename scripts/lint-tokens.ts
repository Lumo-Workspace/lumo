/**
 * Token-discipline lint.
 *
 * Forbids two patterns in business code:
 *   1. Raw hex literals     (#fff, #1a1a1a, #41B40Faa, ...)
 *   2. Neutral palette classes that overlap with the token system
 *      (text-zinc-500, bg-slate-100, border-gray-200, ...) — these
 *      bypass `--background` / `--foreground` / `--muted` / `--border`
 *      etc. Brand palettes (red/blue/violet/...) are NOT flagged: they
 *      have legitimate non-token uses (chart accents, illustrations).
 *
 * Baseline gate
 *   The repo carries ~2 000 pre-existing violations. A strict gate
 *   would block every PR. Instead, scripts/lint-tokens.baseline.json
 *   snapshots the per-file violation count; this script fails only on
 *   **regressions** (a file gains violations, or a new file appears
 *   with any). Cleanups shrink the baseline; running `--update`
 *   re-snapshots after work.
 *
 * Usage:
 *   tsx scripts/lint-tokens.ts            # check against baseline (default)
 *   tsx scripts/lint-tokens.ts --full     # print every violation; ignore baseline
 *   tsx scripts/lint-tokens.ts --update   # rewrite the baseline to current state
 *   tsx scripts/lint-tokens.ts --json     # machine-readable output (combines with above)
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'

export type Rule = 'hex' | 'palette' | 'radius' | 'shadow'

export type Violation = {
  file: string
  line: number
  col: number
  match: string
  rule: Rule
}

/** file path → violation count */
export type Baseline = Record<string, number>

/**
 * File paths (relative to repo root, forward-slash) where hex literals
 * and neutral-palette classes are accepted at any count. Each entry
 * weakens the lint — prefer hoisting values into tokens over expanding
 * this list.
 */
export const ALLOWLIST: ReadonlyArray<RegExp> = [
  // Token-definition files: hex literals here are by design, in three
  // sanctioned categories — (a) the `/* #rrggbb */` round-trip comments next to
  // the oklch base tokens (LUM-257), (b) the named --hljs-* categorical syntax
  // palette mirroring GitHub's themes (LUM-288), and (c) the elevation rgba
  // shadow tiers. The .landing brand fork (LUM-288) is likewise an intentional
  // token override scoped to .landing DOM. New ad-hoc hex in either file is NOT
  // covered by this rationale — hoist it into a documented token instead.
  /^app\/globals\.css$/,
  /^components\/landing\/landing\.css$/,
  // Pre-existing SVG icon set (raw colors are the SVG's payload).
  /^components\/ui\/icons\.tsx$/,
  // Waitlist/signup is a fixed-dark marketing surface (matches the landing
  // aesthetic: near-black bg + white/alpha glass + zinc text). It is
  // intentionally NOT theme-aware, so semantic tokens (which adapt to
  // light/dark) don't model it — same rationale as landing.css.
  /^app\/signup\/\[\[\.\.\.signup\]\]\/page\.tsx$/,
  // Vendored shadcn-io decorative block: the rainbow gradient hex stops
  // ARE the visual payload (not semantic colors), same rationale as the
  // icon set above.
  /^components\/ui\/shadcn-io\/aurora-background\/index\.tsx$/,
  // Categorical tag palette (six fixed hues hashed onto inline tag badges) —
  // decorative category colors, not semantic, so the hex stops are payload.
  // Isolated to this module so the rest of the timeline stays tokenized.
  /\/TaskDetailTimeline\/items\/tag-colors\.ts$/,
  // Tag color presets the user picks from (bright categorical palette) +
  // the custom-hex input's example placeholder — the raw hex IS the payload
  // stored on the tag, not a semantic token. Confined to this module.
  /\/pages\/tag-color-presets\.ts$/,
]

const SCAN_DIRS = ['app', 'components', 'lib'] as const
const SCAN_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js', '.css'])
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.worktrees',
  'dist',
  'out',
  'build',
  '__tests__',
])

// 3, 4, 6, or 8 hex digits prefixed by `#`. `(?<!\w)` blocks matches
// inside identifiers like `cmt#abc123`.
const HEX_RE = /(?<!\w)#[0-9a-fA-F]{3,8}\b/g

// Tailwind utility prefixes that take a color. Forbid only the five neutral
// palettes (zinc/slate/gray/neutral/stone) which overlap with token semantics.
const PALETTE_CLASS_RE =
  /\b(?:text|bg|border|ring|fill|stroke|shadow|from|to|via|outline|divide|placeholder|accent|caret|decoration)-(?:zinc|slate|gray|neutral|stone)-(?:50|[1-9]00|950)(?:\/\d+)?\b/g

// Bare `rounded` (no tier suffix) bypasses the radius scale — its value
// (0.25rem) now equals rounded-sm, so it's semantically redundant. Tiered
// (rounded-md), directional (rounded-l), and arbitrary (rounded-[2px])
// forms are allowed. `(?![-\w])` blocks rounded-md / roundedness; the
// leading `\b` blocks `surrounded`.
const BARE_ROUNDED_RE = /\brounded(?![-\w])/g

// Tailwind built-in shadow scale (`shadow`, `shadow-xs|sm|md|lg|xl|2xl`)
// and arbitrary `shadow-[...]` bypass the elevation system — use
// shadow-elevation-{1,2,3} (shadow-none stays allowed). `(?<![-\w])`
// skips drop-shadow / box-shadow; the optional group means a bare
// `shadow` matches only when NOT followed by another `-segment`, so
// shadow-elevation-1 / shadow-none / shadow-mockup are left alone.
const SHADOW_RE =
  /(?<![-\w])shadow(?:-(?:xs|sm|md|lg|xl|2xl)|-\[[^\]]*\])?(?![-\w])/g

const BASELINE_FILE = 'scripts/lint-tokens.baseline.json'

function normalizePath(p: string): string {
  return p.split(sep).join('/')
}

export function isAllowed(relPath: string): boolean {
  return ALLOWLIST.some(re => re.test(normalizePath(relPath)))
}

/**
 * Pure detection: takes a relative path + file contents, returns the
 * violations. Side-effect-free so it can be unit-tested without touching
 * the filesystem.
 */
export function detectViolations(
  relPath: string,
  content: string
): Violation[] {
  if (isAllowed(relPath)) return []
  // Skip co-located test files (routinely contain test-data colors).
  if (/\.test\.[tj]sx?$/.test(relPath)) return []
  const out: Violation[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // tsconfig's noUncheckedIndexedAccess types lines[i] as string|undefined
    // even though i is bounded by lines.length. Default the rare undefined.
    const line = lines[i] ?? ''
    HEX_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = HEX_RE.exec(line)) !== null) {
      out.push({
        file: relPath,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        rule: 'hex',
      })
    }
    PALETTE_CLASS_RE.lastIndex = 0
    while ((m = PALETTE_CLASS_RE.exec(line)) !== null) {
      out.push({
        file: relPath,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        rule: 'palette',
      })
    }
    BARE_ROUNDED_RE.lastIndex = 0
    while ((m = BARE_ROUNDED_RE.exec(line)) !== null) {
      out.push({
        file: relPath,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        rule: 'radius',
      })
    }
    SHADOW_RE.lastIndex = 0
    while ((m = SHADOW_RE.exec(line)) !== null) {
      out.push({
        file: relPath,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        rule: 'shadow',
      })
    }
  }
  return out
}

const RULE_LABELS: Record<Rule, string> = {
  hex: 'hex literal  ',
  palette: 'palette class',
  radius: 'bare rounded ',
  shadow: 'raw shadow   ',
}

export function countByFile(violations: Violation[]): Baseline {
  const out: Baseline = {}
  for (const v of violations) {
    out[v.file] = (out[v.file] ?? 0) + 1
  }
  return out
}

export type Regression = { file: string; current: number; baseline: number }

/**
 * A file regresses when its current violation count exceeds its baseline
 * (or it has any violations and is absent from the baseline).
 */
export function findRegressions(
  current: Baseline,
  baseline: Baseline
): Regression[] {
  const out: Regression[] = []
  for (const [file, count] of Object.entries(current)) {
    const b = baseline[file] ?? 0
    if (count > b) out.push({ file, current: count, baseline: b })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (SCAN_EXTS.has(extname(entry.name))) {
      yield full
    }
  }
}

function scanRepo(root: string): Violation[] {
  const all: Violation[] = []
  for (const dir of SCAN_DIRS) {
    const abs = join(root, dir)
    try {
      statSync(abs)
    } catch {
      continue
    }
    for (const file of walk(abs)) {
      const rel = normalizePath(relative(root, file))
      const content = readFileSync(file, 'utf8')
      all.push(...detectViolations(rel, content))
    }
  }
  return all
}

function loadBaseline(root: string): Baseline {
  try {
    return JSON.parse(readFileSync(join(root, BASELINE_FILE), 'utf8'))
  } catch {
    return {}
  }
}

function main(): void {
  const args = new Set(process.argv.slice(2))
  const root = process.cwd()
  const violations = scanRepo(root)
  const current = countByFile(violations)

  if (args.has('--update')) {
    const sorted: Baseline = Object.fromEntries(
      Object.entries(current).sort(([a], [b]) => a.localeCompare(b))
    )
    writeFileSync(
      join(root, BASELINE_FILE),
      JSON.stringify(sorted, null, 2) + '\n'
    )
    const total = violations.length
    const files = Object.keys(sorted).length
    process.stdout.write(
      `✓ baseline updated → ${BASELINE_FILE} (${total} violations across ${files} files)\n`
    )
    return
  }

  if (args.has('--full')) {
    if (args.has('--json')) {
      process.stdout.write(JSON.stringify(violations, null, 2) + '\n')
    } else {
      for (const v of violations) {
        const label = RULE_LABELS[v.rule]
        process.stdout.write(
          `${v.file}:${v.line}:${v.col}  ${label}  ${v.match}\n`
        )
      }
      process.stdout.write(
        `\n${violations.length} total violation${violations.length === 1 ? '' : 's'} (audit mode — baseline ignored)\n`
      )
    }
    return
  }

  const baseline = loadBaseline(root)
  const regressions = findRegressions(current, baseline)

  if (args.has('--json')) {
    const offending = new Set(regressions.map(r => r.file))
    process.stdout.write(
      JSON.stringify(
        {
          regressions,
          violations: violations.filter(v => offending.has(v.file)),
        },
        null,
        2
      ) + '\n'
    )
    if (regressions.length > 0) process.exit(1)
    return
  }

  if (regressions.length === 0) {
    process.stdout.write('✓ lint-tokens: no regressions against baseline\n')
    return
  }

  const offending = new Set(regressions.map(r => r.file))
  for (const v of violations) {
    if (!offending.has(v.file)) continue
    const label = RULE_LABELS[v.rule]
    process.stderr.write(`${v.file}:${v.line}:${v.col}  ${label}  ${v.match}\n`)
  }
  process.stderr.write('\nRegressions vs. baseline:\n')
  for (const r of regressions) {
    process.stderr.write(
      `  ${r.file}  ${r.baseline} → ${r.current}  (+${r.current - r.baseline})\n`
    )
  }
  process.stderr.write(
    '\n✗ lint-tokens: token discipline regressed in the above file(s).\n'
  )
  process.stderr.write(
    '  Either hoist the new color into a semantic token in app/globals.css\n'
  )
  process.stderr.write(
    '  (see docs/design-system.md → "Adding a new token"), or — if you\n'
  )
  process.stderr.write(
    '  removed violations and want to lock the new lower count in —\n'
  )
  process.stderr.write(
    '  run `npm run lint:tokens -- --update` and commit the baseline.\n'
  )
  process.exit(1)
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('lint-tokens.ts')) {
  main()
}
