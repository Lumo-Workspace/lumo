/**
 * @jest-environment node
 *
 * LUM-1064 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §6.1, §7 PR5;
 * decision Q4 option A) — the three boundary guards over the WHOLE tree,
 * replacing the per-PR file lists of LUM-1060…1063 (kept next to this file):
 *
 *   1. core code imports no plugin / private file. The only exceptions are
 *      the two installed lists, each importing only its plugin entry;
 *   2. core code does not read or write a plugin table (option A: the tables
 *      stay in the one schema, only the plugin touches them);
 *   3. core tests import no plugin / private file (the mixed-test count is 0);
 *      plugin tests live under __tests__/ee/ and test-utils/ee/.
 *
 * LUM-1065 (PR6) adds: the plugin lives in ee/security/ (only framework-fixed
 * routes / workflows / rules / scripts stay at their old paths), the manifest
 * excludes every plugin and private file, the two installed lists ship as
 * their empty oss/overlay/ versions, and core code names no plugin COLUMN
 * either (guard 2b).
 *
 * "Core" is derived, never listed: every tracked code file the OSS manifest
 * ships, minus what test-utils/ee/plugin-boundary.ts classifies as plugin or
 * private (RFC appendix A + PR1–4 corrections). This suite lives under
 * __tests__/ee/ because it names plugin paths; it only means something in the
 * private repository, where the plugin exists.
 *
 * Report the same numbers from a shell:
 *   npx tsx scripts/oss-export/plugin-boundary-report.ts --list
 */
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import {
  CORE_SECURITY_MODELS,
  INSTALLED_LIST_EDGES,
  PLUGIN_COLUMNS,
  PLUGIN_MODELS,
  SECURITY_MODEL_NAME,
  boundarySets,
  destinationOf,
  extractSpecifiers,
  findPluginColumnAccess,
  findPluginTableAccess,
  forbiddenCoreEdges,
  isPluginTestPath,
  isTestPath,
  loadRepo,
  parseSchemaModels,
  pluginEdges,
  pluginTableAccessRules,
  readManifest,
  resolveSpecifier,
  rfcMixedTests,
  shippedFiles,
  type BoundaryRepo,
} from '@/test-utils/ee/plugin-boundary'

const ROOT = join(__dirname, '../../../../..')
const repo = loadRepo(ROOT)
const sets = boundarySets(repo)
const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const tableRules = pluginTableAccessRules(schema)

/** The real repository plus some in-memory files, for the guards' self-tests. */
function fakeRepo(sources: Record<string, string>): BoundaryRepo {
  const files = new Set([...repo.files, ...Object.keys(sources)])
  const read = (p: string) => sources[p] ?? repo.read(p)
  return {
    ...repo,
    files,
    read,
    importsOf: p =>
      extractSpecifiers(read(p))
        .map(s => resolveSpecifier(p, s, files))
        .filter((t): t is string => t !== null),
  }
}

describe('the core set is derived from the manifest and the module table', () => {
  it('holds the core modules and none of the plugin ones', () => {
    for (const f of [
      'lib/plugins/registry.ts',
      'lib/plugins/workspace-settings.ts',
      'lib/services/boundary-detector.service.ts',
      'lib/security-scan/scan-secrets.ts',
      'lib/security-scan/core-types.ts',
      'lib/security-scan/inject-guard.ts',
      'lib/hook-payload/redact.ts',
      'lib/boundary-crossing/rejudge.ts',
      'app/api/hooks/pre-tool-use/route.ts',
      'shared/src/untrusted-content.ts',
    ])
      expect(sets.coreProd).toContain(f)
    for (const f of [
      'ee/security/server.ts',
      'ee/security/client.tsx',
      'ee/security/services/pr-security-scan.service.ts',
      'ee/security/services/pr-review-control.service.ts',
      'ee/security/repositories/project-policy.repository.ts',
      'ee/security/repositories/security-columns.repository.ts',
      'ee/security/boundary-crossing/sensitive-read.ts',
      'ee/security/llm/crossing-explain-client.ts',
      'ee/private/boundary-crossing/eval/run.ts',
      'scripts/security/scan-reliability.ts',
      // Framework-fixed paths: excluded by the manifest, not moved.
      'app/api/tasks/[id]/security-scans/route.ts',
      'app/api/cron/sweep-security-scans/route.ts',
      'lib/workflows/security-hunt.ts',
      'lib/workflows/security-hunt.steps.ts',
      'security/semgrep-rules/llm.ts',
    ]) {
      expect(sets.coreProd).not.toContain(f)
      expect(destinationOf(f)).not.toBe('core')
    }
    // Excluded from the snapshot by the manifest → not core either.
    expect(sets.coreProd).not.toContain('scripts/oss-export.ts')
    expect(sets.coreProd.length).toBeGreaterThan(1500)
  })

  it('every installed list names an existing plugin entry and ships only as its empty overlay', () => {
    for (const [list, entries] of Object.entries(INSTALLED_LIST_EDGES)) {
      expect(destinationOf(list)).toBe('core')
      expect(sets.coreProd).not.toContain(list) // excluded, overlaid
      expect(repo.files.has(`oss/overlay/${list}`)).toBe(true)
      for (const e of entries) {
        expect(repo.files.has(e)).toBe(true)
        expect(destinationOf(e)).toBe('plugin')
      }
    }
  })

  it('the manifest ships no plugin or private file (PR6)', () => {
    const shipped = shippedFiles(repo.tracked, readManifest(repo))
    expect(shipped.filter(f => destinationOf(f) !== 'core')).toEqual([])
    expect(
      shipped.filter(f => /^(ee|__tests__\/ee|test-utils\/ee)\//.test(f))
    ).toEqual([])
    // What is left of the plugin outside ee/ is framework-fixed: App Router
    // routes and Vercel Workflows files (plus the rules and operator scripts).
    const left = repo.tracked.filter(
      f =>
        destinationOf(f) !== 'core' &&
        !/^(ee|scripts\/security|security)\//.test(f) &&
        f !== 'scripts/backfill-prv-rejudge.ts'
    )
    expect(left.length).toBeGreaterThan(0)
    for (const f of left)
      expect([
        f,
        /^app\/api\/.*\/route\.ts$|^lib\/workflows\/[^/]+\.ts$/.test(f),
      ]).toEqual([f, true])
  })
})

describe('the OSS overlay of the installed lists (RFC §3.3)', () => {
  const OVERLAY = join(ROOT, 'oss/overlay')
  const overlayFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory()
        ? overlayFiles(join(dir, e.name))
        : [relative(OVERLAY, join(dir, e.name)).split('\\').join('/')]
    )

  it('overlays exactly the two installed lists (plus the contributor CLAUDE.md)', () => {
    expect(overlayFiles(OVERLAY).sort()).toEqual(
      ['CLAUDE.md', ...Object.keys(INSTALLED_LIST_EDGES)].sort()
    )
  })

  it('each overlay exports the same name and type as the real list, empty, and imports no plugin', () => {
    for (const list of Object.keys(INSTALLED_LIST_EDGES)) {
      const decl = (src: string) =>
        /export const (\w+): (readonly \w+\[\]) = \[/.exec(src)?.slice(1)
      const real = repo.read(list)
      const overlay = repo.read(`oss/overlay/${list}`)
      expect(decl(real)).toBeDefined()
      expect(decl(overlay)).toEqual(decl(real))
      expect(overlay).toMatch(/= \[\]\s*$/)
      // Resolved as if it stood at the list's own path, as in the snapshot.
      expect(pluginEdges(fakeRepo({ [list]: overlay }), [list])).toEqual([])
    }
  })
})

describe('guard 1: core code imports no plugin or private file', () => {
  it('no core file imports a plugin / private file', () => {
    expect(forbiddenCoreEdges(repo, sets.coreProd)).toEqual([])
  })

  it('the installed lists import exactly their plugin entry, nothing else of the plugin', () => {
    for (const [list, entries] of Object.entries(INSTALLED_LIST_EDGES))
      expect(pluginEdges(repo, [list]).map(e => e.to)).toEqual(entries)
  })

  it('catches every import form the export check knows (self-test)', () => {
    const probe = 'lib/services/zz-lum1064-probe.ts'
    const forms = [
      `import { x } from '@/ee/security/services/pr-security-scan.service'`,
      `import '@/ee/security/server'`,
      `const m = await import('@/ee/security/boundary-crossing/sensitive-read')`,
      `const r = require('../../ee/security/repositories/project-policy.repository')`,
      `jest.mock('@/ee/security/llm/crossing-explain-client')`,
      `export * from '@/ee/private/boundary-crossing/eval/run'`,
      `import type { T } from '@/ee/security/security-scan/types'`,
      `import { POST } from '@/app/api/tasks/[id]/security-scans/route'`,
      `import { x } from '@/lib/workflows/security-hunt.steps'`,
    ]
    for (const src of forms) {
      const fake = fakeRepo({ [probe]: src })
      expect(forbiddenCoreEdges(fake, [probe])).toHaveLength(1)
    }
    // Core targets and the installed lists' own entries pass.
    const ok = fakeRepo({
      [probe]: [
        `import { scanSecrets } from '@/lib/security-scan/scan-secrets'`,
        `import type { RawSecretFinding } from '@/lib/security-scan/core-types'`,
        `import { getPluginRegistry } from '@/lib/plugins/registry'`,
      ].join('\n'),
    })
    expect(forbiddenCoreEdges(ok, [probe])).toEqual([])
    // …but an installed list may not import another plugin file.
    const list = 'lib/plugins/installed.ts'
    const widened = fakeRepo({
      [list]: `import { securityPlugin } from '@/ee/security/server'\nimport { x } from '@/ee/security/policy-rules'`,
    })
    expect(forbiddenCoreEdges(widened, [list]).map(e => e.to)).toEqual([
      'ee/security/policy-rules.ts',
    ])
  })
})

describe('guard 2: core code does not touch the plugin tables (Q4 option A)', () => {
  it('the plugin models exist in the schema and their core relations are derived from it', () => {
    const models = new Set(parseSchemaModels(schema).map(m => m.name))
    for (const m of PLUGIN_MODELS) expect(models.has(m)).toBe(true)
    expect(tableRules.delegates).toEqual([
      'prSecurityScan',
      'prSecurityFinding',
      'projectPolicy',
    ])
    expect(tableRules.relationFields).toEqual(
      expect.arrayContaining([
        { model: 'Project', field: 'projectPolicies', target: 'ProjectPolicy' },
        { model: 'Task', field: 'securityScans', target: 'PrSecurityScan' },
        {
          model: 'PullRequest',
          field: 'securityScans',
          target: 'PrSecurityScan',
        },
      ])
    )
  })

  it('every security-looking model is classified plugin or core on purpose', () => {
    const named = parseSchemaModels(schema)
      .map(m => m.name)
      .filter(n => SECURITY_MODEL_NAME.test(n))
    const classified = new Set<string>([
      ...PLUGIN_MODELS,
      ...CORE_SECURITY_MODELS,
    ])
    expect(named.filter(n => !classified.has(n))).toEqual([])
  })

  it('no core file reads or writes a plugin table', () => {
    const hits = sets.coreProd.flatMap(f =>
      findPluginTableAccess(f, repo.read(f), tableRules)
    )
    expect(hits).toEqual([])
  })

  it('catches prisma / tx / bracket / relation / raw-SQL access (self-test)', () => {
    const access = [
      'await prisma.prSecurityScan.findMany({ where: { taskId } })',
      'await tx.prSecurityFinding.updateMany({ data })',
      'return this.db.projectPolicy.findFirst()',
      'client?.prSecurityScan.count()',
      "const d = prisma['projectPolicy']",
      'include: { securityScans: true },',
      'select: { projectPolicies: { take: 1 } },',
      'await prisma.$queryRaw`SELECT 1 FROM "PrSecurityScan"`',
    ]
    for (const line of access)
      expect(findPluginTableAccess('x.ts', line, tableRules)).toHaveLength(1)
    const fine = [
      'await prisma.boundaryCrossing.findMany()',
      'prSecurityScanRepository.findLatest(id)',
      'securityScans: (taskId: string) => `/api/tasks/${taskId}/security-scans`,',
      '// prisma.prSecurityScan is the plugin’s',
      ' * see prisma.projectPolicy in the plugin',
    ]
    for (const line of fine)
      expect(findPluginTableAccess('x.ts', line, tableRules)).toEqual([])
  })
})

describe('guard 2b: core code names no plugin column (LUM-1065, Q4 option A)', () => {
  it('the plugin columns exist on their core models', () => {
    const fields = new Map(
      parseSchemaModels(schema).map(m => [m.name, m.fields.map(f => f[0])])
    )
    for (const [model, cols] of Object.entries(PLUGIN_COLUMNS))
      for (const c of cols)
        expect([model, c, fields.get(model)?.includes(c)]).toEqual([
          model,
          c,
          true,
        ])
  })

  it('no core server file reads or writes a plugin column', () => {
    // cli/ is an HTTP client: `lumo workspace security-scan` names the
    // plugin API's JSON fields (and gets a 404 without the plugin), never a
    // database column.
    const hits = sets.coreProd
      .filter(f => !f.startsWith('cli/'))
      .flatMap(f => findPluginColumnAccess(f, repo.read(f)))
    expect(hits).toEqual([])
  })

  it('catches select / where / data / property / string access, not comments (self-test)', () => {
    for (const line of [
      'select: { securityPolicy: true },',
      'where: { scanEvidenceRetentionDays: 0 },',
      'data: { lastSarifIngestAt: at },',
      'return row.securityBaseline',
      "  'securityHuntEnabled',",
      'if (ws.securityScanEnabled) run() // gate',
    ])
      expect(findPluginColumnAccess('x.ts', line)).toHaveLength(1)
    for (const line of [
      '// the plugin owns securityPolicy',
      ' * `ProjectRepository.securityBaseline` is the plugin’s',
      'const securityPolicyLabel = 1',
      'boundaryGateEnabled: true,',
    ])
      expect(findPluginColumnAccess('x.ts', line)).toEqual([])
  })
})

describe('guard 3: core tests import no plugin or private file', () => {
  it('no core test imports a plugin / private file (mixed tests: 0)', () => {
    const offenders = [
      ...new Set(pluginEdges(repo, sets.coreTests).map(e => e.from)),
    ]
    expect(offenders).toEqual([])
  })

  it('every RFC appendix A "mixed" test sits under the plugin test roots', () => {
    expect(rfcMixedTests(repo).filter(f => !isPluginTestPath(f))).toEqual([])
  })

  it('plugin tests are only where PR6 can exclude them in one glob', () => {
    expect(sets.pluginTests.length).toBeGreaterThan(150)
    for (const f of sets.pluginTests) expect(isPluginTestPath(f)).toBe(true)
    expect(isTestPath('__tests__/ee/security/x.test.ts')).toBe(true)
    expect(isPluginTestPath('__tests__/security-scan/x.test.ts')).toBe(false)
  })

  it('a core test that mocks a plugin module counts as importing it (self-test)', () => {
    const probe = '__tests__/zz-lum1064-probe.test.ts'
    const fake = fakeRepo({
      [probe]: `jest.mock('@/ee/security/services/pr-security-reminder.service', () => ({}))`,
    })
    expect(pluginEdges(fake, [probe]).map(e => e.to)).toEqual([
      'ee/security/services/pr-security-reminder.service.ts',
    ])
  })
})
