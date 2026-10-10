/**
 * @jest-environment node
 *
 * LUM-1068 — the core Forbidden rule source against a real Postgres (PGlite,
 * every migration replayed): the new migration applies on a database with
 * data, the snapshot repository's insert-or-ignore and compare-and-swap hold
 * under concurrency, and the hook detector — with no plugin installed and no
 * repository mocked — writes one POLICY_WEAKENING row for a deleted rule.
 * Only the GitHub file read is stubbed (an in-memory CLAUDE.md; the
 * repository's own file is never touched).
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'
import { withSoftDelete } from '@/lib/db/soft-delete'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const migration = '20261029090000_lum1068_forbidden_rule_snapshots'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: migration,
})
const holder: { client: import('@prisma/client').PrismaClient | null } = {
  client: null,
}
jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return holder.client
  },
}))
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
const repoFiles = new Map<string, string>()
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(
    async (opts: { path: string }) => repoFiles.get(opts.path) ?? null
  ),
}))

import { forbiddenRuleSnapshotRepository } from '@/lib/repositories/forbidden-rule-snapshot.repository'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { __resetForbiddenRuleSourceCache } from '@/lib/services/forbidden-rule-source.service'
import { parseForbiddenRules } from '@/lib/boundary-crossing/forbidden-rules'

jest.setTimeout(180_000)

const CLAUDE_MD = `# CLAUDE.md

## Forbidden

- Never delete files in prisma/migrations/
- Never push to main or develop directly
`

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!) as never
  await harness.insert('workspaces', { id: 'ws', name: 'W', slug: 'w' })
  await harness.insert('workspace_members', {
    id: 'member',
    workspaceId: 'ws',
    clerkId: 'clerk-ws',
  })
  await harness.insert('teams', {
    id: 'team',
    workspaceId: 'ws',
    name: 'Lumo',
    identifier: 'LUM',
  })
  await harness.insert('projects', {
    id: 'p-1',
    workspaceId: 'ws',
    teamId: 'team',
    createdByMemberId: 'member',
    name: 'App',
  })
  await harness.applyMigration(migration)
  await harness.insert('project_repositories', {
    id: 'pr-1',
    projectId: 'p-1',
    fullName: 'acme/app',
    name: 'app',
    isDefault: true,
  })
  await harness.insert('tasks', {
    id: 't-1',
    projectId: 'p-1',
    teamId: 'team',
    number: 1,
    title: 'T',
  })
})
afterAll(async () => harness.stop())

test('the migration adds an empty table on a database with projects', async () => {
  const rows = await harness.query<{ n: number }>(
    'select count(*)::int as n from forbidden_rule_snapshots'
  )
  expect(rows[0]!.n).toBe(0)
})

test('insert-or-ignore and compare-and-swap: one winner each', async () => {
  const rules = parseForbiddenRules(CLAUDE_MD, 'CLAUDE.md')
  await harness.insert('projects', {
    id: 'p-2',
    workspaceId: 'ws',
    teamId: 'team',
    createdByMemberId: 'member',
    name: 'Other',
  })
  const created = await Promise.all(
    [0, 1, 2].map(() =>
      forbiddenRuleSnapshotRepository.createIfAbsent({
        projectId: 'p-2',
        sourceHash: 'h0',
        rules,
      })
    )
  )
  expect(created.filter(Boolean)).toHaveLength(1)
  const advanced = await Promise.all(
    ['h1', 'h2', 'h3'].map(h =>
      forbiddenRuleSnapshotRepository.advance({
        projectId: 'p-2',
        fromSourceHash: 'h0',
        sourceHash: h,
        rules: rules.slice(1),
      })
    )
  )
  expect(advanced.filter(Boolean)).toHaveLength(1)
  const snap = await forbiddenRuleSnapshotRepository.findByProject('p-2')
  expect(snap).toMatchObject({
    previousSourceHash: 'h0',
    rules: rules.slice(1),
  })
  expect(['h1', 'h2', 'h3']).toContain(snap!.sourceHash)
})

test('no plugin: a deleted Forbidden rule is one POLICY_WEAKENING row in the database', async () => {
  const event = {
    taskId: 't-1',
    hookEventId: null,
    toolName: 'Read',
    filePath: 'README.md',
    payload: { tool_input: { file_path: 'README.md' } },
  }
  repoFiles.set('CLAUDE.md', CLAUDE_MD)
  __resetForbiddenRuleSourceCache()
  await boundaryDetectorService.detectAndRecord(event)
  repoFiles.set(
    'CLAUDE.md',
    CLAUDE_MD.replace('- Never push to main or develop directly\n', '')
  )
  __resetForbiddenRuleSourceCache()
  await boundaryDetectorService.detectAndRecord(event)
  __resetForbiddenRuleSourceCache()
  await boundaryDetectorService.detectAndRecord(event)

  const rows = await harness.query<Record<string, unknown>>(
    `select "taskId", "workspaceId", number, category, severity, advisory,
            disposition, "policyRuleRef", "policyRuleText", reversible
       from boundary_crossings`
  )
  expect(rows).toEqual([
    {
      taskId: 't-1',
      workspaceId: 'ws',
      number: 1,
      category: 'POLICY_WEAKENING',
      severity: 'HIGH',
      advisory: false,
      disposition: null,
      policyRuleRef: expect.stringMatching(/^forbidden:[0-9a-f]{16}$/),
      policyRuleText: 'Never push to main or develop directly',
      reversible: true,
    },
  ])
  const snap = await forbiddenRuleSnapshotRepository.findByProject('p-1')
  expect(snap!.rules.map(r => r.text)).toEqual([
    'Never delete files in prisma/migrations/',
  ])
})
