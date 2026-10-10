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
 * "Core" is derived, never listed: every tracked code file the OSS manifest
 * ships, minus what test-utils/ee/plugin-boundary.ts classifies as plugin or
 * private (RFC appendix A + PR1–4 corrections). This suite lives under
 * __tests__/ee/ because it names plugin paths; it only means something in the
 * private repository, where the plugin exists.
 *
 * Report the same numbers from a shell:
 *   npx tsx scripts/oss-export/plugin-boundary-report.ts --list
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CORE_SECURITY_MODELS,
  INSTALLED_LIST_EDGES,
  PLUGIN_MODELS,
  SECURITY_MODEL_NAME,
  boundarySets,
  destinationOf,
  extractSpecifiers,
  findPluginTableAccess,
  forbiddenCoreEdges,
  isPluginTestPath,
  isTestPath,
  loadRepo,
  parseSchemaModels,
  pluginEdges,
  pluginTableAccessRules,
  resolveSpecifier,
  rfcMixedTests,
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
      'lib/plugins/installed.ts',
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
      'lib/services/pr-security-scan.service.ts',
      'lib/services/pr-review-control.service.ts',
      'lib/repositories/project-policy.repository.ts',
      'lib/boundary-crossing/sensitive-read.ts',
      'lib/llm/crossing-explain-client.ts',
      'lib/boundary-crossing/eval/run.ts',
      'scripts/security/scan-reliability.ts',
    ]) {
      expect(sets.coreProd).not.toContain(f)
      expect(destinationOf(f)).not.toBe('core')
    }
    // Excluded from the snapshot by the manifest → not core either.
    expect(sets.coreProd).not.toContain('scripts/oss-export.ts')
    expect(sets.coreProd.length).toBeGreaterThan(1500)
  })

  it('every installed list is core and names an existing plugin entry', () => {
    for (const [list, entries] of Object.entries(INSTALLED_LIST_EDGES)) {
      expect(sets.coreProd).toContain(list)
      for (const e of entries) {
        expect(repo.files.has(e)).toBe(true)
        expect(destinationOf(e)).toBe('plugin')
      }
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
      `import { x } from '@/lib/services/pr-security-scan.service'`,
      `import '@/ee/security/server'`,
      `const m = await import('@/lib/boundary-crossing/sensitive-read')`,
      `const r = require('../repositories/project-policy.repository')`,
      `jest.mock('@/lib/llm/crossing-explain-client')`,
      `export * from '@/lib/boundary-crossing/eval/run'`,
      `import type { T } from '@/lib/security-scan/types'`,
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
      [probe]: `jest.mock('@/lib/services/pr-security-reminder.service', () => ({}))`,
    })
    expect(pluginEdges(fake, [probe]).map(e => e.to)).toEqual([
      'lib/services/pr-security-reminder.service.ts',
    ])
  })
})
