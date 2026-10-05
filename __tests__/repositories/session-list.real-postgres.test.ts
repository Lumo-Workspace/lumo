/**
 * @jest-environment node
 *
 * LUM-932 P4: /sessions read models against a REAL Postgres (PGlite).
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'

jest.setTimeout(180_000)

const R = 'root-r'
const C = `${R}:a1`
const S = 'root-s'
const OTHER = 'root-other'
const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s))

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'ws', slug: 'ws' })
  await harness.insert('workspace_members', {
    id: 'm1',
    workspaceId: 'ws',
    clerkId: 'c1',
  })
  await harness.insert('workspace_members', {
    id: 'm2',
    workspaceId: 'ws',
    clerkId: 'c2',
  })
  await harness.insert('teams', {
    id: 'team',
    workspaceId: 'ws',
    name: 'Lumo',
    identifier: 'LUM',
  })
  await harness.insert('projects', {
    id: 'project',
    workspaceId: 'ws',
    teamId: 'team',
    createdByMemberId: 'm1',
    name: 'P',
  })
  for (const n of [1, 2]) {
    await harness.insert('tasks', {
      id: `T${n}`,
      projectId: 'project',
      teamId: 'team',
      number: n,
      title: `T${n}`,
    })
  }
  const session = (id: string, extra: Record<string, unknown> = {}) =>
    harness.insert('sessions', {
      id,
      workspaceId: 'ws',
      workspaceMemberId: 'm1',
      startedAt: t(0).toISOString(),
      lastActivityAt: t(9).toISOString(),
      ...extra,
    })
  await session(R, { lastActivityAt: t(20).toISOString() })
  await session(C, {
    parentSessionId: R,
    agentId: 'a1',
    agentType: 'Explore',
    taskId: 'T2',
    bindingSource: 'ATTACH',
    lastActivityAt: t(30).toISOString(),
  })
  await session(S, { taskId: 'T1', bindingSource: 'ATTACH' })
  await session(OTHER, { workspaceMemberId: 'm2' })

  const segment = (id: string, sessionId: string, taskId: string, extra = {}) =>
    harness.insert('task_attribution_segments', {
      id,
      workspaceId: 'ws',
      sessionId,
      taskId,
      fromTurn: 0,
      toTurn: 3,
      fromAt: t(1).toISOString(),
      computeVersion: 1,
      evidence: JSON.stringify([]),
      ...extra,
    })
  await segment('seg1', R, 'T1', {
    source: 'INFERRED',
    confidence: 'HIGH',
    evidence: JSON.stringify([
      { kind: 'BRANCH', identifier: 'LUM-1', at: t(2).toISOString() },
    ]),
  })
  await segment('seg2', C, 'T2', {
    source: 'SUBAGENT_ATTACH',
    confidence: 'EXPLICIT',
  })
  await segment('seg3', S, 'T1', {
    source: 'SESSION_ATTACH',
    confidence: 'EXPLICIT',
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('session list read models on a real Postgres', () => {
  it('listForClerkUser returns only top-level sessions of that user', async () => {
    const rows = await sessionRepository.listForClerkUser('c1')
    expect(rows.map(r => r.id).sort()).toEqual([R, S].sort())
    expect(rows[0]).toEqual(
      expect.objectContaining({ id: R, taskId: null, eventCount: 0 })
    )
  })

  it('summarizeFamilies counts subagents and unions task ids', async () => {
    const map = await sessionRepository.summarizeFamilies([R, S])
    const r = map.get(R)!
    expect(r.subagentCount).toBe(1)
    expect([...r.taskIds].sort()).toEqual(['T1', 'T2'])
    expect(map.get(S)).toEqual({ subagentCount: 0, taskIds: ['T1'] })
  })

  it('summarizeFamilies returns an empty entry for a root with nothing', async () => {
    const map = await sessionRepository.summarizeFamilies([OTHER])
    expect(map.get(OTHER)).toEqual({ subagentCount: 0, taskIds: [] })
  })

  it('listFamilyAttribution returns root and child rows with identifiers', async () => {
    const rows = await sessionRepository.listFamilyAttribution(R)
    expect(rows).toHaveLength(2)
    const root = rows.find(x => x.sessionId === R)!
    expect(root).toMatchObject({
      parentSessionId: null,
      agentType: null,
      taskIdentifier: 'LUM-1',
      source: 'INFERRED',
      confidence: 'HIGH',
      fromTurn: 0,
      toTurn: 3,
    })
    expect(root.evidence).toEqual([
      { kind: 'BRANCH', identifier: 'LUM-1', at: t(2).toISOString() },
    ])
    expect(rows.find(x => x.sessionId === C)).toMatchObject({
      parentSessionId: R,
      agentType: 'Explore',
      taskIdentifier: 'LUM-2',
      source: 'SUBAGENT_ATTACH',
    })
  })

  it('listChildSessions lists the children of a root', async () => {
    expect(await sessionRepository.listChildSessions(R)).toEqual([
      { id: C, agentType: 'Explore' },
    ])
  })

  it('findRootBinding returns the bound task identifier and binding source', async () => {
    expect(await sessionRepository.findRootBinding(S)).toEqual({
      taskIdentifier: 'LUM-1',
      bindingSource: 'ATTACH',
    })
    expect(await sessionRepository.findRootBinding(R)).toBeNull()
    expect(await sessionRepository.findRootBinding('missing')).toBeNull()
  })

  it('findDetailById returns the row with its access scope, unscoped', async () => {
    expect(await sessionRepository.findDetailById(OTHER)).toMatchObject({
      id: OTHER,
      workspaceId: 'ws',
      workspaceMemberId: 'm2',
      member: { clerkId: 'c2' },
      parentSessionId: null,
      workspace: { slug: 'ws' },
    })
    expect(await sessionRepository.findDetailById('missing')).toBeNull()
  })
})
