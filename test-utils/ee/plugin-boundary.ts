/**
 * LUM-1064 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §6.1, §7 PR5,
 * appendix A/B) — the MIT core / security plugin boundary as data, for the
 * boundary guard tests under __tests__/ee/security/ and for
 * `npx tsx scripts/oss-export/plugin-boundary-report.ts`.
 *
 * Nothing here is a hand-kept list of core files. The core is derived:
 *
 *   core code = every tracked code file the OSS manifest (oss/manifest.json)
 *               ships, minus the files the module table below classifies as
 *               plugin or private.
 *
 * So a new file is core by default and is guarded the day it lands; moving a
 * file into `ee/` (PR6) or under a plugin prefix makes it plugin. The module
 * table is RFC appendix A's `MODULES` with the corrections PR1–PR4 recorded
 * (#1373, #1378, #1380, #1379) and the PR6 paths (LUM-1065): the plugin
 * lives in `ee/security/`, the private evaluation set in `ee/private/`, and
 * only framework-fixed files (routes, workflows, semgrep rules, operator
 * scripts) stay at their old paths. First match wins.
 *
 * Tests follow the same split by LOCATION: a test under `__tests__/ee/` or
 * `test-utils/ee/` is a plugin (or private) test and may import anything;
 * every other shipped test is a core test and must not import a plugin or
 * private file. The manifest excludes `__tests__/ee/**` and `test-utils/ee/**`
 * from the OSS snapshot together with the plugin code (LUM-1065).
 *
 * The import rules are the ones `scripts/oss-export/manifest.ts` applies to
 * the export (static / side-effect / dynamic `import`, `require`,
 * `require.resolve`, `jest.mock` and friends; `@/` and relative paths), plus
 * `@lumo/shared` → `shared/src` like the RFC script. This file cannot import
 * the manifest module (scripts/oss-export/ never ships, test-utils/ does), so
 * the excluded __tests__/scripts/oss-export-manifest.test.ts pins that both
 * agree on every tracked file.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export type Destination = 'core' | 'plugin' | 'private'

// ── module table (RFC appendix A, first match wins) ─────────────────────────

const R = (s: string) => new RegExp(s)

/**
 * [module id, destination, path regex]. Unmatched files are core.
 *
 * LUM-1065 (PR6) moved the plugin into `ee/security/` and the private
 * evaluation set into `ee/private/`, so every plugin / private module is
 * listed FIRST (an `ee/` path can never fall through to a core module).
 * What stays at its old path does so because of a framework constraint:
 * App Router routes (the URL is the path), Vercel Workflows files (workflow
 * and step ids embed the path), the semgrep rules (pinned byte-identical,
 * never compiled) and the operator scripts.
 */
export const BOUNDARY_MODULES: ReadonlyArray<
  readonly [string, Destination, RegExp]
> = [
  [
    // LUM-1064: shipped scripts the RFC scope (app/components/lib/…) did not
    // cover. They drive the scan sandbox / hunt / the policy compiler and
    // import those modules directly, so they go with the plugin.
    'plugin-scripts',
    'plugin',
    R('^scripts/security/|^scripts/backfill-prv-rejudge\\.ts$'),
  ],
  ['crossing-eval', 'private', R('^ee/private/')],
  [
    'crossing-ai',
    'plugin',
    R(
      '^ee/security/(boundary-crossing/triage|services/boundary-crossing-triage|llm/crossing-explain-client|ai/evaluation\\.ts$|components/TaskDetailTimeline/CrossingTriageLine)|^app/api/cron/triage-crossings/|^app/api/tasks/\\[id\\]/boundary-crossings/\\[crossingId\\]/system-explain/'
    ),
  ],
  [
    'policy-rules',
    'plugin',
    R(
      '^ee/security/(services/policy/|repositories/project-policy|llm/(policy-compiler|code-rule-judge)-client|boundary-crossing/(push-target-match|action-rule-match))|^app/api/internal/policy-check/'
    ),
  ],
  [
    'crossing-detectors-adv',
    'plugin',
    R(
      '^ee/security/(boundary-crossing/(destructive-fs|sensitive-read|untrusted-code|action-confirm)|llm/action-confirm-client)'
    ),
  ],
  [
    'scan-hunt',
    'plugin',
    R(
      '^ee/security/(security-scan/(hunt|graph)/|services/security-(hunt|graph-rules)|llm/security-(hunt|falsifier))|^lib/workflows/security-hunt'
    ),
  ],
  [
    'scan-managed',
    'plugin',
    R(
      '^ee/security/(services/security-(managed-scan|baseline)|security-scan/semgrep-rules|services/sandbox-credential-scrub|integrations/vercel-sandbox/)|^lib/workflows/security-(managed-scan|baseline-scan)|^security/'
    ),
  ],
  [
    'scan-sarif',
    'plugin',
    R(
      '^ee/security/(security-scan/sarif\\.ts$|services/security-sarif|validation/security-sarif|auth/(sarif-ingest-auth|github-oidc))|^lib/workflows/security-sarif|^app/api/integrations/security/sarif/|^app/api/cron/prune-security-sarif/'
    ),
  ],
  [
    'scan-ai-review',
    'plugin',
    R(
      '^ee/security/(security-scan/(review-kinds|review-context|related-context|truncate|judge-budget|pr-summary|verifier|diff-snippet|suggestion)\\.ts$|services/(review-verifier|review-context|security-suggest)|llm/(security-judge|review-verifier|review-ranker|security-disposition-falsifier)-client)|^lib/workflows/(review-verifier|security-suggest)'
    ),
  ],
  [
    'scan-retention',
    'plugin',
    R(
      '^ee/security/(security-scan/evidence-retention|services/(scan-evidence-retention|scan-code-retention)|components/settings/ScanEvidenceRetentionRow)|^app/api/cron/sweep-(expired-scan-evidence|unconfirmed-scan-code)/'
    ),
  ],
  [
    'scan-core',
    'plugin',
    R(
      // The rest of the plugin tree (entries, UI slots, scan orchestration,
      // the #1367 review control, the plugin-column repository) and the
      // routes / workflows that stay at their framework-fixed paths.
      '^ee/|^lib/workflows/security-pr-review|^app/api/tasks/\\[id\\]/security-(findings|scans)/|^app/api/pull-requests/\\[number\\]/scans/|^app/api/workspaces/me/security-scan/|^app/api/workspaces/me/policy-coverage/|^app/api/internal/pr-security-scan/|^app/api/cron/sweep-security-scans/'
    ),
  ],
  [
    'redaction',
    'core',
    R(
      // PR1 (#1373): `core-types` is the core half of the old types barrel.
      '^lib/security-scan/(redact|scan-secrets|secret-patterns|storage-redaction|secret-stock/|core-types)|^lib/services/secret-stock-reredact|^lib/repositories/secret-stock'
    ),
  ],
  [
    'code-redaction',
    'core',
    R(
      '^lib/hook-payload/redact\\.ts$|^lib/services/hook-ingest-policy\\.service|^lib/services/pr-comment-code-scrub|^lib/integrations/github/mirror-code-strip|^lib/services/hook-event-code-backfill|^lib/repositories/hook-event-code-backfill'
    ),
  ],
  [
    'inject-guard',
    'core',
    R(
      '^lib/security-scan/inject-guard|^shared/src/untrusted-(content|fence)\\.ts$'
    ),
  ],
  [
    'shared-scan-format',
    'core',
    R('^shared/src/(security-scan|hunt-audit)\\.ts$'),
  ],
  [
    'crossing-detectors',
    'core',
    R(
      '^lib/boundary-crossing/(command-shape|judge-timeout)|^lib/services/boundary-detector'
    ),
  ],
  [
    'crossing-rejudge',
    'core',
    R(
      '^lib/boundary-crossing/rejudge|^lib/services/boundary-crossing-rejudge|^app/api/cron/rejudge-crossings/'
    ),
  ],
  [
    'crossing-core',
    'core',
    R(
      '^lib/boundary-crossing/|^lib/services/(boundary-crossing|crossing-raw-retention)|^lib/repositories/(boundary-crossing|crossing-|open-crossing-move)|^lib/disposition/|^lib/validation/boundary-crossing|^app/api/tasks/\\[id\\]/boundary-crossings/|BoundaryCrossingsPanel|boundary-(explain|format)\\.ts$|crossing-groups\\.ts$|useBoundaryCrossings|CrossingRawRetentionRow'
    ),
  ],
]

/** RFC §1 scope (+ `ee/` and the plugin scripts): only files here are
 *  matched against the table. */
const SCOPE =
  /^(app|components|lib|hooks|types|constants|shared\/src|mcp|extensions|security|ee|scripts\/security)\/|^(instrumentation|proxy)\.ts$|^scripts\/backfill-prv-rejudge\.ts$/

export const CODE_FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

/** The module a path belongs to, or null (unclassified ⇒ core). */
export function boundaryModuleOf(path: string): string | null {
  if (!SCOPE.test(path)) return null
  for (const [id, , re] of BOUNDARY_MODULES) if (re.test(path)) return id
  return null
}

export function destinationOf(path: string): Destination {
  if (!SCOPE.test(path)) return 'core'
  for (const [, dest, re] of BOUNDARY_MODULES) if (re.test(path)) return dest
  return 'core'
}

// ── tests ────────────────────────────────────────────────────────────────────

export function isTestPath(path: string): boolean {
  return (
    /^(__tests__|tests|test-utils|__stubs__)\//.test(path) ||
    /(^|\/)__tests__\//.test(path) ||
    /\.test\.[cm]?[jt]sx?$/.test(path)
  )
}

/** Where plugin (and private) tests live; PR6 excludes these with the plugin. */
export const PLUGIN_TEST_ROOTS = ['__tests__/ee/', 'test-utils/ee/'] as const

export function isPluginTestPath(path: string): boolean {
  return PLUGIN_TEST_ROOTS.some(r => path.startsWith(r))
}

// ── the two files allowed to name the plugin (RFC §3.3, overlaid in PR6) ────

export const INSTALLED_LIST_EDGES: Readonly<Record<string, readonly string[]>> =
  {
    'lib/plugins/installed.ts': ['ee/security/server.ts'],
    'lib/plugins/installed.client.ts': ['ee/security/client.tsx'],
  }

// ── import graph (same rules as scripts/oss-export/manifest.ts) ─────────────

const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"\n]+)['"]/g,
  /\bimport\s+['"]([^'"\n]+)['"]/g,
  /\b(?:import|require|require\.resolve|jest\.(?:mock|doMock|unmock|requireActual|requireMock))\s*\(\s*['"]([^'"\n]+)['"]/g,
]

export function extractSpecifiers(source: string): string[] {
  const out = new Set<string>()
  for (const re of SPECIFIER_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) out.add(m[1]!)
  }
  return [...out]
}

const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
]

export function resolveSpecifier(
  fromFile: string,
  spec: string,
  files: ReadonlySet<string>
): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec === '@lumo/shared' || spec.startsWith('@lumo/shared/'))
    base = 'shared/src' + spec.slice('@lumo/shared'.length)
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = posix.join(posix.dirname(fromFile), spec)
  else return null
  base = posix.normalize(base)
  for (const suffix of RESOLVE_SUFFIXES) {
    if (files.has(base + suffix)) return base + suffix
  }
  const js = /\.(m|c)?jsx?$/.exec(base)
  if (js) {
    const stem = base.slice(0, -js[0].length)
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
      if (files.has(stem + ext)) return stem + ext
    }
  }
  return null
}

// ── manifest globs (same semantics as scripts/oss-export/manifest.ts) ───────

export function globToRegExp(glob: string): RegExp {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const prevIsSep = i === 0 || glob[i - 1] === '/'
        const next = glob[i + 2]
        if (prevIsSep && next === '/') {
          re += '(?:.*/)?'
          i += 3
          continue
        }
        re += '.*'
        i += 2
        continue
      }
      re += '[^/]*'
      i += 1
      continue
    }
    if (c === '?') {
      re += '[^/]'
      i += 1
      continue
    }
    re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c
    i += 1
  }
  return new RegExp(`^${re}$`)
}

interface ManifestGlobs {
  include: ReadonlyArray<{ glob: string }>
  exclude: ReadonlyArray<{ glob: string }>
}

/** Files the OSS snapshot exports: an include matches and no exclude does. */
export function shippedFiles(
  files: readonly string[],
  manifest: ManifestGlobs
): string[] {
  const inc = manifest.include.map(r => globToRegExp(r.glob))
  const exc = manifest.exclude.map(r => globToRegExp(r.glob))
  return files.filter(
    f => !exc.some(re => re.test(f)) && inc.some(re => re.test(f))
  )
}

// ── the repository, read once ───────────────────────────────────────────────

export interface BoundaryRepo {
  root: string
  tracked: string[]
  files: ReadonlySet<string>
  read(path: string): string
  /** Resolved import targets of a code file (memoised). */
  importsOf(path: string): string[]
}

export function loadRepo(root: string): BoundaryRepo {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\0')
    .filter(Boolean)
  const files = new Set(tracked)
  const sources = new Map<string, string>()
  const read = (p: string) => {
    let s = sources.get(p)
    if (s === undefined) {
      try {
        s = readFileSync(join(root, p), 'utf8')
      } catch {
        s = '' // tracked but deleted in the working tree
      }
      sources.set(p, s)
    }
    return s
  }
  const imports = new Map<string, string[]>()
  return {
    root,
    tracked,
    files,
    read,
    importsOf(p) {
      let out = imports.get(p)
      if (!out) {
        out = [
          ...new Set(
            extractSpecifiers(read(p))
              .map(s => resolveSpecifier(p, s, files))
              .filter((t): t is string => t !== null)
          ),
        ]
        imports.set(p, out)
      }
      return out
    },
  }
}

export function readManifest(repo: BoundaryRepo): ManifestGlobs {
  return JSON.parse(repo.read('oss/manifest.json')) as ManifestGlobs
}

export interface BoundarySets {
  /** Shipped, non-test code files that are core. */
  coreProd: string[]
  /** Shipped test code files outside the plugin test roots. */
  coreTests: string[]
  /** Test code files under the plugin test roots. */
  pluginTests: string[]
}

export function boundarySets(repo: BoundaryRepo): BoundarySets {
  const shipped = shippedFiles(repo.tracked, readManifest(repo)).filter(f =>
    CODE_FILE_RE.test(f)
  )
  const coreProd: string[] = []
  const coreTests: string[] = []
  for (const f of shipped) {
    if (isTestPath(f)) {
      if (!isPluginTestPath(f)) coreTests.push(f)
    } else if (destinationOf(f) === 'core') coreProd.push(f)
  }
  const pluginTests = repo.tracked.filter(
    f => isPluginTestPath(f) && CODE_FILE_RE.test(f)
  )
  return { coreProd, coreTests, pluginTests }
}

export interface BoundaryEdge {
  from: string
  to: string
  module: string | null
}

/** Imports from `fromFiles` into plugin / private files. */
export function pluginEdges(
  repo: BoundaryRepo,
  fromFiles: readonly string[]
): BoundaryEdge[] {
  const out: BoundaryEdge[] = []
  for (const from of fromFiles)
    for (const to of repo.importsOf(from))
      if (destinationOf(to) !== 'core')
        out.push({ from, to, module: boundaryModuleOf(to) })
  return out
}

/** Core prod edges minus the two installed lists' own entry imports. */
export function forbiddenCoreEdges(
  repo: BoundaryRepo,
  coreProd: readonly string[]
): BoundaryEdge[] {
  return pluginEdges(repo, coreProd).filter(
    e => !(INSTALLED_LIST_EDGES[e.from] ?? []).includes(e.to)
  )
}

/**
 * RFC appendix A `--mixed`: tests that import both a core-side SECURITY module
 * and a plugin/private file (68 at e6f0a1d08). Kept for the before/after
 * report; the guard itself is location-based (core tests import no plugin).
 */
export function rfcMixedTests(repo: BoundaryRepo): string[] {
  return repo.tracked
    .filter(f => isTestPath(f) && CODE_FILE_RE.test(f))
    .filter(f => {
      const ts = repo.importsOf(f)
      return (
        ts.some(t => destinationOf(t) !== 'core') &&
        ts.some(
          t => boundaryModuleOf(t) !== null && destinationOf(t) === 'core'
        )
      )
    })
}

// ── plugin tables (RFC §4, decision Q4 option A) ────────────────────────────

/**
 * Prisma models only the security plugin may read or write. The table stays
 * in the one core schema (migrations are never deleted); the core must not
 * touch it. `pr-review-control` (#1367) reads `PrSecurityScan`, which is why
 * it is classified plugin above.
 */
export const PLUGIN_MODELS = [
  'PrSecurityScan',
  'PrSecurityFinding',
  'ProjectPolicy',
  // LUM-1127: the PR write-back's per-PR finding threads.
  'PrFindingThread',
  // LUM-1131: thread replies' repository-scoped learnings.
  'PrReviewLearning',
] as const

/**
 * Security-named models that are core on purpose (crossings are core, RFC
 * §2). A new model whose name looks like security must be put in one of the
 * two lists — see SECURITY_MODEL_NAME.
 */
export const CORE_SECURITY_MODELS = [
  'BoundaryCrossing',
  'BoundaryCrossingExplanation',
  'CrossingSuppressionRule',
] as const

export const SECURITY_MODEL_NAME =
  /Secur|Scan|Sarif|Hunt|Polic|Crossing|Finding|Triage|Secret/

export interface SchemaModel {
  name: string
  /** [field name, field type without `?` / `[]`]. */
  fields: Array<[string, string]>
}

export function parseSchemaModels(schema: string): SchemaModel[] {
  const out: SchemaModel[] = []
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(schema)) !== null) {
    const fields: Array<[string, string]> = []
    for (const line of m[2]!.split('\n')) {
      const f = /^\s+(\w+)\s+(\w+)(\[\])?\??(\s|$)/.exec(line)
      if (f && !line.trim().startsWith('//') && !line.trim().startsWith('@@'))
        fields.push([f[1]!, f[2]!])
    }
    out.push({ name: m[1]!, fields })
  }
  return out
}

const lowerFirst = (s: string) => s[0]!.toLowerCase() + s.slice(1)

export interface PluginTableAccessRules {
  /** Prisma client delegates: `prisma.prSecurityScan`, `tx.projectPolicy`… */
  delegates: string[]
  /** Relation fields of CORE models that point at a plugin model. */
  relationFields: Array<{ model: string; field: string; target: string }>
}

export function pluginTableAccessRules(schema: string): PluginTableAccessRules {
  const models = parseSchemaModels(schema)
  const plugin = new Set<string>(PLUGIN_MODELS)
  const relationFields: PluginTableAccessRules['relationFields'] = []
  for (const model of models) {
    if (plugin.has(model.name)) continue
    for (const [field, type] of model.fields)
      if (plugin.has(type))
        relationFields.push({ model: model.name, field, target: type })
  }
  return { delegates: PLUGIN_MODELS.map(lowerFirst), relationFields }
}

export interface TableAccessHit {
  file: string
  line: number
  kind: 'delegate' | 'relation' | 'raw-sql'
  text: string
}

/**
 * Plugin-table access in one source file:
 *  - a client delegate: `prisma.prSecurityScan`, `tx.prSecurityFinding`,
 *    `this.db.projectPolicy`, `client?.projectPolicy`, `db['prSecurityScan']`;
 *  - a relation of a core model in a Prisma query shape:
 *    `include: { securityScans: true }`, `select: { projectPolicies: { … } }`;
 *  - a quoted table name in raw SQL: `"PrSecurityScan"`.
 * Line comments are skipped.
 */
export function findPluginTableAccess(
  file: string,
  source: string,
  rules: PluginTableAccessRules
): TableAccessHit[] {
  const d = rules.delegates.join('|')
  const rel = [...new Set(rules.relationFields.map(r => r.field))].join('|')
  const patterns: Array<[TableAccessHit['kind'], RegExp]> = [
    ['delegate', new RegExp(`\\??\\.\\s*(?:${d})\\b`)],
    ['delegate', new RegExp(`\\[\\s*['"\`](?:${d})['"\`]\\s*\\]`)],
    ['raw-sql', new RegExp(`"(?:${PLUGIN_MODELS.join('|')})"`)],
  ]
  if (rel)
    patterns.push([
      'relation',
      new RegExp(`(?:^|[\\s{,])(?:${rel})\\s*:\\s*(?:true\\b|\\{)`),
    ])
  const hits: TableAccessHit[] = []
  source.split('\n').forEach((text, i) => {
    const code = text.replace(/^\s*(\/\/|\*|\/\*).*$/, '')
    for (const [kind, re] of patterns)
      if (re.test(code)) {
        hits.push({ file, line: i + 1, kind, text: text.trim() })
        break
      }
  })
  return hits
}

// ── plugin columns on core models (LUM-1065, Q4 option A) ───────────────────

/**
 * Columns of CORE models that only the security plugin reads or writes
 * (RFC §4). They stay in the one schema; the core reaches them only through
 * the `workspaceSettings` extension point, which never names them.
 */
export const PLUGIN_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  Workspace: [
    'securityPolicy',
    'securityScanEnabled',
    'securityAiReviewEnabled',
    'securityHuntEnabled',
    'scanEvidenceRetentionDays',
  ],
  ProjectRepository: ['lastSarifIngestAt', 'securityBaseline'],
}

export interface ColumnAccessHit {
  file: string
  line: number
  column: string
  text: string
}

/**
 * Lines of one source file that name a plugin column as an identifier or a
 * string (`select: { securityPolicy: true }`, `row.lastSarifIngestAt`,
 * `'scanEvidenceRetentionDays'`). Comment lines are skipped — a core comment
 * may mention the plugin's column; code may not touch it.
 */
export function findPluginColumnAccess(
  file: string,
  source: string,
  columns: Readonly<Record<string, readonly string[]>> = PLUGIN_COLUMNS
): ColumnAccessHit[] {
  const names = [...new Set(Object.values(columns).flat())]
  const re = new RegExp(`\\b(${names.join('|')})\\b`)
  const hits: ColumnAccessHit[] = []
  source.split('\n').forEach((text, i) => {
    const code = text
      .replace(/^\s*(\/\/|\*|\/\*).*$/, '')
      .replace(/\/\/.*$/, '')
    const m = re.exec(code)
    if (m) hits.push({ file, line: i + 1, column: m[1]!, text: text.trim() })
  })
  return hits
}
