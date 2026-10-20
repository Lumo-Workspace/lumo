/**
 * Token-discipline lint.
 *
 * Forbids these patterns in business code:
 *   1. Raw hex literals     (#fff, #1a1a1a, #41B40Faa, ...)
 *   2. Neutral palette classes that overlap with the token system
 *      (text-zinc-500, bg-slate-100, border-gray-200, ...) — these
 *      bypass `--background` / `--foreground` / `--muted` / `--border`.
 *   3. Brand palette classes (text-blue-500, bg-emerald-100, ...) — these
 *      leak ad-hoc Tailwind brand colors past the token system (LUM-290).
 *      Legitimate categorical color belongs in semantic feedback/status
 *      tokens or the `--chart-*` data-viz palette (consumed as bg-chart-1
 *      etc., which are NOT brand classes so they pass). Decorative-payload
 *      surfaces (icons, illustrations, landing, tag palettes) are carried
 *      by the ALLOWLIST; the existing brand-color backlog is frozen in the
 *      baseline so the rule only blocks NEW leaks.
 *   4. Free-form type classes in app UI (LUM-1244) — see TYPE_SCALE_* below.
 *      App UI uses only the six semantic tiers (text-caption / text-body /
 *      text-body-strong / text-title / text-heading / text-display).
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

export type Rule =
  | 'hex'
  | 'palette'
  | 'brand'
  | 'radius'
  | 'shadow'
  | 'zindex'
  | 'type-scale'

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
  // Vendored shadcn-io decorative block: the rainbow gradient hex stops
  // ARE the visual payload (not semantic colors), same rationale as the
  // icon set above.
  /^components\/ui\/shadcn-io\/aurora-background\/index\.tsx$/,
  // Tag color presets the user picks from (bright categorical palette) +
  // the custom-hex input's example placeholder — the raw hex IS the payload
  // stored on the tag, not a semantic token. Confined to this module.
  /\/pages\/tag-color-presets\.ts$/,
  // Default coding-agent avatar color — a payload hex stored on the actor /
  // sent to the client (member.service + AssigneeSelect default), not a CSS
  // token. Single source of truth confined to this module.
  /^lib\/constants\/avatar\.ts$/,
  // Rich-text editor font/highlight color palettes — users pick a hex that's
  // written into the document (TipTap marks), so the raw hex is payload data,
  // not a CSS token. Confined to this module.
  /\/bubble-menu\/editor-colors\.ts$/,
  // Tag colour palettes + the light/dark derivation every tag renderer uses
  // (LUM-1276) — payload hex stored on / hashed onto tags, not a CSS token.
  // Confined to this module.
  /\/document\/tag-colors\.ts$/,
  // Payload color constants (e.g. the default Sentry "bug" tag color) — hex
  // stored as data in the DB, not a CSS token. Confined to this module.
  /^lib\/constants\/colors\.ts$/,
  // Agent brand colors (AGENT_META) — each coding agent's brand hex, payload
  // rendered as the badge accent, not a semantic token.
  /\/AgentBadge\.tsx$/,
  // Vendor brand logo SVGs — the fixed brand hex IS the icon's payload, same
  // rationale as components/ui/icons.tsx.
  /\/(Slack|Figma|GoogleDrive)Icon\.tsx$/,
  // HTML email templates — email clients can't use CSS vars, so inline hex is
  // required; these are not theme-aware app surfaces.
  /^lib\/integrations\/email\/templates\//,
  // Landing marketing surface — an intentional brand fork (LUM-288), same
  // rationale as components/landing/landing.css; its components carry brand hex.
  /^components\/landing\//,
  // Vendored shadcn NavigationMenu — its indicator uses a `z-[1]` LOCAL stacking
  // value (raise the arrow above the viewport within its own context); the
  // semantic z scale (z-base=0 … z-toast=60) has no "+1 above sibling" tier, so
  // this is a documented local-stacking carve-out (LUM-285), not a global tier.
  /^components\/ui\/navigation-menu\.tsx$/,
]

// LUM-1065: `ee/` holds the security plugin's UI (absent in the OSS snapshot).
const SCAN_DIRS = ['app', 'components', 'lib', 'ee'] as const
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

// Brand palette classes (LUM-290): any Tailwind brand color family on a color
// utility. These leak ad-hoc color past the token system — use a semantic
// feedback/status token or the --chart-* palette (bg-chart-1, which is NOT a
// brand family, so it passes). Neutrals are intentionally excluded here (the
// `palette` rule owns them); `--chart-*` is a token namespace, not a family.
const BRAND_CLASS_RE =
  /\b(?:text|bg|border|ring|fill|stroke|shadow|from|to|via|outline|divide|placeholder|accent|caret|decoration)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:\/\d+)?\b/g

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

// Arbitrary Tailwind z-index utility (z-[1], z-[100], z-[calc(...)]). Named
// tiers (z-dropdown / z-modal / ...) and the default scale (z-10/z-50) are
// allowed; only the arbitrary escape hatch bypasses the semantic z scale.
const Z_ARBITRARY_RE = /\bz-\[[^\]]+\]/g

// ─── Type scale (LUM-1244) ────────────────────────────────────────────────────
// App UI sizes text with the six semantic tiers only. Flagged, with or without
// a variant prefix (md:, hover:, data-[state=open]:, ...):
//   - Tailwind size scale: text-xs, text-sm, text-lg, text-xl … text-9xl
//   - arbitrary sizes: text-[11px], text-[0.75rem], text-[1.2em]
//   - weights the tiers already carry or that sit outside them: font-medium,
//     font-bold, font-extrabold, font-black
//   - text-base, UNLESS the same line also sets an md: semantic tier. That is
//     the iOS zoom guard on form fields (`text-base md:text-body`): inputs must
//     render at 16px on phones or Safari zooms on focus. Requiring the md: tier
//     on the same class string keeps the exemption self-describing and stops a
//     stray `text-base` title from slipping through.
// Allowed: the tiers themselves, font-semibold / font-normal (state emphasis
// layered on a tier, e.g. the active menu item or `text-caption font-semibold`
// labels), font-mono, and text-<colour> utilities.
//
// Scope: .ts/.tsx under app/, components/, ee/ — constants modules hold shared
// class strings too. Out of scope: the landing fork (already in ALLOWLIST),
// app/page.tsx (marketing home), components/ui/typography.tsx (prose scale),
// and email templates (they live under lib/, which this rule doesn't scan).
//
// Grandfathered in the baseline (each one intentional, reviewed in LUM-1244):
//   app/onboarding/OnboardingClient.tsx ×2 — 48px full-width choice buttons
//     use text-base on purpose (larger tap-target label).
//   components/ui/sidebar/menu.tsx ×1 — vendored shadcn sidebar's
//     data-[active=true]:font-medium (state emphasis on the active item).
//   components/security/SecurityPage.tsx ×1 — font-medium inline link inside
//     16px body copy (emphasis on a link, not a size tier).
// Like every rule here the scan is line-based and doesn't parse comments:
// write prose as "the medium weight", not the class name.
const TYPE_SCALE_SCOPE_RE = /^(?:app|components|ee)\/.+\.tsx?$/
const TYPE_SCALE_EXEMPT: ReadonlyArray<RegExp> = [
  /^app\/page\.tsx$/,
  /^components\/ui\/typography\.tsx$/,
]
const TYPE_SIZE_RE =
  /(?<![-\w])(?:text-(?:xs|sm|lg|[2-9]?xl)(?![-\w])|text-\[\d*\.?\d+(?:px|rem|em)\])/g
const TYPE_WEIGHT_RE =
  /(?<![-\w])font-(?:medium|bold|extrabold|black)(?![-\w])/g
const TEXT_BASE_RE = /(?<![-\w])text-base(?![-\w])/g
const MD_TIER_RE =
  /(?<![-\w])md:text-(?:caption|body|body-strong|title|heading|display)(?![-\w])/

export function isTypeScaleScoped(relPath: string): boolean {
  const p = normalizePath(relPath)
  return (
    TYPE_SCALE_SCOPE_RE.test(p) && !TYPE_SCALE_EXEMPT.some(re => re.test(p))
  )
}

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
  const typeScale = isTypeScaleScoped(relPath)
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
    BRAND_CLASS_RE.lastIndex = 0
    while ((m = BRAND_CLASS_RE.exec(line)) !== null) {
      out.push({
        file: relPath,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        rule: 'brand',
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
    Z_ARBITRARY_RE.lastIndex = 0
    while ((m = Z_ARBITRARY_RE.exec(line)) !== null) {
      out.push({
        file: relPath,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        rule: 'zindex',
      })
    }
    if (typeScale) {
      const res = MD_TIER_RE.test(line)
        ? [TYPE_SIZE_RE, TYPE_WEIGHT_RE]
        : [TYPE_SIZE_RE, TYPE_WEIGHT_RE, TEXT_BASE_RE]
      for (const re of res) {
        re.lastIndex = 0
        while ((m = re.exec(line)) !== null) {
          out.push({
            file: relPath,
            line: i + 1,
            col: m.index + 1,
            match: m[0],
            rule: 'type-scale',
          })
        }
      }
    }
  }
  return out
}

const RULE_LABELS: Record<Rule, string> = {
  hex: 'hex literal  ',
  palette: 'palette class',
  brand: 'brand class  ',
  radius: 'bare rounded ',
  shadow: 'raw shadow   ',
  zindex: 'arbitrary z  ',
  'type-scale': 'type scale   ',
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
  process.stderr.write(
    '  Type-scale hits: use a semantic tier (text-caption / text-body /\n'
  )
  process.stderr.write(
    '  text-body-strong / text-title / text-heading / text-display) — see\n'
  )
  process.stderr.write('  docs/design-system/typography-scale.md.\n')
  process.exit(1)
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('lint-tokens.ts')) {
  main()
}
