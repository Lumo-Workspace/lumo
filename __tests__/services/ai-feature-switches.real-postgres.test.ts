/**
 * @jest-environment node
 *
 * LUM-1338 — the AI feature switches against a REAL Postgres (every
 * migration replayed into PGlite): the stored JSON reads back, the "switched
 * off" lookup matches only workspaces that turned the feature off (an absent
 * JSON path is NULL in SQL, so a workspace on the defaults must not be
 * caught), and the lineage audit backlog leaves exactly those out.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { aiFeatureSwitchRepository } from '@/lib/repositories/ai-feature-switch.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

jest.setTimeout(180_000)

function db() {
  return harness.prisma!
}

let taskNumber = 0

/** A workspace with one DONE task whose session has one unvoted edge. */
async function seed(id: string, switches: object) {
  await db().workspace.create({
    data: { id, name: id, slug: id, aiFeatureSwitches: switches },
  })
  await db().workspaceMember.create({
    data: { id: `${id}_member`, workspaceId: id, clerkId: `${id}_clerk` },
  })
  await db().team.create({
    data: { id: `${id}_team`, workspaceId: id, name: id, identifier: 'AF' },
  })
  await db().project.create({
    data: {
      id: `${id}_project`,
      workspaceId: id,
      teamId: `${id}_team`,
      createdByMemberId: `${id}_member`,
      name: id,
    },
  })
  await db().task.create({
    data: {
      id: `${id}_task`,
      projectId: `${id}_project`,
      workspaceId: id,
      teamId: `${id}_team`,
      number: ++taskNumber,
      title: id,
      status: 'DONE',
    },
  })
  await db().session.create({
    data: {
      id: `${id}_session`,
      workspaceId: id,
      workspaceMemberId: `${id}_member`,
      lastActivityAt: new Date('2026-10-01T00:00:00Z'),
    },
  })
  await db().lineageEdge.create({
    data: {
      workspaceId: id,
      taskId: `${id}_task`,
      sessionId: `${id}_session`,
      fragmentType: 'MEMORY',
      fragmentId: `${id}_memory`,
    },
  })
}

beforeAll(async () => {
  await harness.start()
  await seed('ws_default', {})
  await seed('ws_other_off', { features: { turnSummary: false } })
  await seed('ws_feature_off', { features: { memoryConsolidation: false } })
  await seed('ws_group_off', { groups: { memory: false } })
  await seed('ws_master_off', { master: false })
})

afterAll(async () => {
  await harness.stop()
})

it('a new workspace starts with no switches stored (= all on)', async () => {
  await db().workspace.create({
    data: { id: 'ws_fresh', name: 'fresh', slug: 'ws-fresh' },
  })
  expect(
    await aiFeatureSwitchRepository.findRaw({ workspaceId: 'ws_fresh' })
  ).toEqual({})
  expect(
    await aiFeatureSwitchRepository.findRaw({ taskId: 'ws_group_off_task' })
  ).toEqual({ groups: { memory: false } })
  expect(
    await aiFeatureSwitchRepository.findRaw({
      sessionId: 'ws_master_off_session',
    })
  ).toEqual({ master: false })
})

it('finds exactly the workspaces that switched the feature off — never the defaults', async () => {
  const off = await aiFeatureSwitchRepository.findWorkspaceIdsWithFeatureOff(
    'memoryConsolidation'
  )
  expect(off.sort()).toEqual([
    'ws_feature_off',
    'ws_group_off',
    'ws_master_off',
  ])
})

it('the audit backlog leaves those workspaces out and keeps the rest', async () => {
  const all = await lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks(50)
  expect(all).toHaveLength(5)
  const kept = await lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks(
    50,
    undefined,
    {
      excludeWorkspaceIds:
        await aiFeatureSwitchRepository.findWorkspaceIdsWithFeatureOff(
          'memoryConsolidation'
        ),
    }
  )
  expect(kept.sort()).toEqual(['ws_default_session', 'ws_other_off_session'])
})
