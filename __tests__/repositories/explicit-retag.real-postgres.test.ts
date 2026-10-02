/**
 * @jest-environment node
 *
 * LUM-932 P3: explicit binding always wins, proven against a REAL Postgres
 * (every migration replayed into PGlite). An unbound session whose events were
 * provisionally tagged t12 is attached to t13: every event moves to t13, the
 * open crossing on a provisionally tagged event follows, and a dispositioned
 * crossing stays where it was ruled. Only the database shows that
 * `taskId: { not }` skips SQL NULL while the OR clause still catches it.
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

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { attributionRepository } from '@/lib/repositories/attribution.repository'

jest.setTimeout(180_000)

const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s))

async function seedEvent(id: string, sessionId: string, taskId: string | null) {
  await harness.insert('hook_events', {
    id,
    workspaceId: 'ws',
    workspaceMemberId: 'member',
    sessionId,
    type: 'PRE_TOOL_USE',
    payload: JSON.stringify({ tool_name: 'Bash', id }),
    createdAt: t(1).toISOString(),
    ...(taskId ? { taskId } : {}),
  })
}

async function seedCrossing(
  id: string,
  hookEventId: string,
  taskId: string,
  disposition: string | null
) {
  await harness.insert('boundary_crossings', {
    id,
    taskId,
    hookEventId,
    category: 'DESTRUCTIVE_DB_COMMAND',
    detail: 'd',
    ...(disposition
      ? { disposition, dispositionedAt: t(2).toISOString() }
      : {}),
  })
}

async function taskOf(table: string, id: string) {
  const rows = await harness.query<{ taskId: string | null }>(
    `select "taskId" from ${table} where id = $1`,
    [id]
  )
  return rows[0]!.taskId
}

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'ws', slug: 'ws' })
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
    id: 'project',
    workspaceId: 'ws',
    teamId: 'team',
    createdByMemberId: 'member',
    name: 'P',
  })
  for (const n of [12, 13, 14]) {
    await harness.insert('tasks', {
      id: `task_${n}`,
      projectId: 'project',
      teamId: 'team',
      number: n,
      title: `T${n}`,
      ...(n === 14 ? { deletedAt: t(0).toISOString() } : {}),
    })
  }
  const session = (id: string, extra: Record<string, unknown> = {}) =>
    harness.insert('sessions', {
      id,
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      startedAt: t(0).toISOString(),
      lastActivityAt: t(9).toISOString(),
      ...extra,
    })
  await session('S')
  await session('S:a1', { parentSessionId: 'S', agentId: 'a1' })
  await session('OTHER')
})

afterAll(async () => {
  await harness.stop()
})

describe('explicit binding overrides provisional tags on a real Postgres', () => {
  it('attach moves every event of the session to t13 with its open crossing; a dispositioned crossing stays', async () => {
    await seedEvent('e_prov1', 'S', 'task_12')
    await seedEvent('e_prov2', 'S', 'task_12')
    await seedEvent('e_null', 'S', null)
    await seedEvent('e_other_session', 'OTHER', 'task_12')
    await seedCrossing('c_open', 'e_prov1', 'task_12', null)
    await seedCrossing('c_ruled', 'e_prov2', 'task_12', 'CONFIRMED')
    await seedCrossing('c_other', 'e_other_session', 'task_12', null)

    const r = await hookEventRepository.retagSessionEventsToExplicitTask(
      'S',
      'task_13'
    )

    expect(r).toEqual({ eventsUpdated: 3, crossingsMoved: 1 })
    for (const id of ['e_prov1', 'e_prov2', 'e_null'])
      expect(await taskOf('hook_events', id)).toBe('task_13')
    expect(await taskOf('boundary_crossings', 'c_open')).toBe('task_13')
    expect(await taskOf('boundary_crossings', 'c_ruled')).toBe('task_12')
    // Another session is untouched.
    expect(await taskOf('hook_events', 'e_other_session')).toBe('task_12')
    expect(await taskOf('boundary_crossings', 'c_other')).toBe('task_12')

    // Idempotent: a re-attach to the same task changes nothing.
    await expect(
      hookEventRepository.retagSessionEventsToExplicitTask('S', 'task_13')
    ).resolves.toEqual({ eventsUpdated: 0, crossingsMoved: 0 })
  })

  it('inherit to an unbound child retags its provisionally tagged events too', async () => {
    await seedEvent('e_child_prov', 'S:a1', 'task_12')
    await seedEvent('e_child_null', 'S:a1', null)
    await seedCrossing('c_child_open', 'e_child_prov', 'task_12', null)

    const r = await sessionRepository.inheritTaskToUnboundChildren(
      'S',
      'task_13'
    )

    expect(r).toEqual({
      childCount: 1,
      retaggedEventCount: 2,
      crossingsMoved: 1,
    })
    expect(await taskOf('hook_events', 'e_child_prov')).toBe('task_13')
    expect(await taskOf('hook_events', 'e_child_null')).toBe('task_13')
    expect(await taskOf('boundary_crossings', 'c_child_open')).toBe('task_13')
  })

  it('findOpenSegmentTask skips an open segment whose task is in the trash', async () => {
    await harness.insert('task_attribution_segments', {
      id: 'seg_trashed',
      workspaceId: 'ws',
      sessionId: 'OTHER',
      taskId: 'task_14',
      fromTurn: 0,
      toTurn: 0,
      fromAt: t(1).toISOString(),
      source: 'INFERRED',
      confidence: 'HIGH',
      evidence: JSON.stringify([]),
      computeVersion: 1,
    })
    await expect(
      attributionRepository.findOpenSegmentTask('ws', ['OTHER'])
    ).resolves.toBeNull()
  })
})
