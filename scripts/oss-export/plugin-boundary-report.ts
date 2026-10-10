/**
 * LUM-1064 — read-only report of the core / security-plugin boundary (RFC
 * docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §7 PR5). Same data the
 * guard tests under __tests__/ee/security/lib/plugins/ assert on:
 *
 *   npx tsx scripts/oss-export/plugin-boundary-report.ts            # counts
 *   npx tsx scripts/oss-export/plugin-boundary-report.ts --list     # + every offending file
 *   npx tsx scripts/oss-export/plugin-boundary-report.ts --file <p> # plugin imports of one file
 *
 * Counts:
 *  - core→plugin edges: shipped core code importing a plugin/private file,
 *    the two installed lists' entry imports not counted;
 *  - core tests importing plugin/private files (must be 0 after PR5);
 *  - RFC appendix A "mixed" tests (core-side security module + plugin);
 *  - plugin-table access in core code;
 *  - plugin-column access in core server code (LUM-1065; cli/ is an HTTP
 *    client and names API fields, not columns).
 * Lives under scripts/oss-export/ (never shipped) because it names plugin
 * paths and reads the private manifest.
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  boundarySets,
  destinationOf,
  boundaryModuleOf,
  findPluginColumnAccess,
  findPluginTableAccess,
  forbiddenCoreEdges,
  loadRepo,
  pluginEdges,
  pluginTableAccessRules,
  rfcMixedTests,
} from '../../test-utils/ee/plugin-boundary'

const root = join(__dirname, '../..')
const repo = loadRepo(root)
const args = process.argv.slice(2)
const out = (s: string) => process.stdout.write(s + '\n')

const fileArg = args.indexOf('--file')
if (fileArg >= 0) {
  const f = args[fileArg + 1]
  if (!f) {
    out('usage: --file <repo path>')
    process.exit(2)
  }
  out(`${f}: ${destinationOf(f)}`)
  for (const e of pluginEdges(repo, [f]))
    out(`  -> ${e.to} [${e.module ?? '?'}]`)
  process.exit(0)
}

const list = args.includes('--list')
const sets = boundarySets(repo)
const edges = forbiddenCoreEdges(repo, sets.coreProd)
const coreTestEdges = pluginEdges(repo, sets.coreTests)
const coreTestsTouching = [...new Set(coreTestEdges.map(e => e.from))].sort()
const mixed = rfcMixedTests(repo)
const mixedOutsidePluginRoots = mixed.filter(f => sets.coreTests.includes(f))
const rules = pluginTableAccessRules(
  readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
)
const tableHits = sets.coreProd.flatMap(f =>
  findPluginTableAccess(f, repo.read(f), rules)
)
const columnHits = sets.coreProd
  .filter(f => !f.startsWith('cli/'))
  .flatMap(f => findPluginColumnAccess(f, repo.read(f)))

out(`core prod files: ${sets.coreProd.length}`)
out(`core test files: ${sets.coreTests.length}`)
out(
  `plugin test files (__tests__/ee, test-utils/ee): ${sets.pluginTests.length}`
)
out(`core->plugin import edges (installed lists excluded): ${edges.length}`)
out(`core tests importing plugin/private files: ${coreTestsTouching.length}`)
out(
  `RFC appendix A mixed tests: ${mixed.length} (outside the plugin test roots: ${mixedOutsidePluginRoots.length})`
)
out(`plugin-table access in core code: ${tableHits.length}`)
out(`plugin-column access in core server code: ${columnHits.length}`)
if (list) {
  for (const e of edges) out(`  edge: ${e.from} -> ${e.to} [${e.module}]`)
  for (const f of coreTestsTouching)
    out(
      `  core test: ${f} -> ${coreTestEdges
        .filter(e => e.from === f)
        .map(e => `${e.to} [${boundaryModuleOf(e.to)}]`)
        .join(', ')}`
    )
  for (const f of mixed) out(`  mixed: ${f}`)
  for (const h of tableHits)
    out(`  table: ${h.file}:${h.line} (${h.kind}) ${h.text}`)
  for (const h of columnHits)
    out(`  column: ${h.file}:${h.line} (${h.column}) ${h.text}`)
}
