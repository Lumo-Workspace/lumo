/**
 * @jest-environment node
 *
 * LUM-932 P3 final review fixes, proven against a REAL Postgres (every
 * migration replayed into PGlite) where a mocked Prisma hid the behavior:
 *  - STEWARD sessions are excluded from inferred session counts (I2);
 *  - a steward bind clears earlier provisional event tags and moves their
 *    open crossings to no task (I2).
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
// The detector itself is covered elsewhere; here only WHAT it is replayed on.
const detectAndRecord = jest.fn()
jest.mock('@/lib/services/boundary-detector.service', () => ({
  boundaryDetectorService: {
    detectAndRecord: (...a: unknown[]) => detectAndRecord(...a),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { recomputeAttributionSafely } from '@/lib/attribution/trigger'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { attributionRepository } from '@/lib/repositories/attribution.repository'
import {
  inferredTopLevelSessionsForTasks,
  taskHasSessions,
} from '@/lib/repositories/task-attribution-where'

jest.setTimeout(180_000)

const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s))

async function seedSession(id: string, extra: Record<string, unknown> = {}) {
  await harness.insert('sessions', {
    id,
    workspaceId: 'ws',
    workspaceMemberId: 'member',
    startedAt: t(0).toISOString(),
    lastActivityAt: t(9).toISOString(),
    ...extra,
  })
}

async function seedEvent(
  id: string,
  sessionId: string,
  taskId: string | null,
  extra: Record<string, unknown> = {}
) {
  await harness.insert('hook_events', {
    id,
    workspaceId: 'ws',
    workspaceMemberId: 'member',
    sessionId,
    type: 'PRE_TOOL_USE',
    payload: JSON.stringify({ tool_name: 'Bash', id }),
    createdAt: t(1).toISOString(),
    ...(taskId ? { taskId } : {}),
    ...extra,
  })
}

async function seedCrossing(
  id: string,
  hookEventId: string | null,
  taskId: string,
  disposition: string | null,
  extra: Record<string, unknown> = {}
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
    ...extra,
  })
}

async function seedSegment(id: string, sessionId: string, taskId: string) {
  await harness.insert('task_attribution_segments', {
    id,
    workspaceId: 'ws',
    sessionId,
    taskId,
    fromTurn: 0,
    toTurn: 0,
    fromAt: t(1).toISOString(),
    source: 'INFERRED',
    confidence: 'HIGH',
    evidence: JSON.stringify([]),
    computeVersion: 1,
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
  for (const n of [12, 13, 20, 21]) {
    await harness.insert('tasks', {
      id: `task_${n}`,
      projectId: 'project',
      teamId: 'team',
      number: n,
      title: `T${n}`,
    })
  }
  await harness.insert('milestones', {
    id: 'ms_1',
    projectId: 'project',
    name: 'M1',
    slug: 'm1',
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('STEWARD sessions are never counted as inferred work (I2)', () => {
  it('inferredTopLevelSessionsForTasks / taskHasSessions skip a STEWARD session with a stale INFERRED segment', async () => {
    await seedSession('U20')
    await seedSegment('seg_u20', 'U20', 'task_20')
    await seedSession('STW21', { role: 'STEWARD', milestoneId: 'ms_1' })
    await seedSegment('seg_stw21', 'STW21', 'task_21')
    // A STEWARD role without a milestone is no steward binding: still counted.
    await seedSession('STW20', { role: 'STEWARD' })
    await seedSegment('seg_stw20', 'STW20', 'task_20')

    const counted = await harness.prisma!.session.findMany({
      where: inferredTopLevelSessionsForTasks(['task_20', 'task_21']),
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    expect(counted.map(s => s.id)).toEqual(['STW20', 'U20'])

    const worked = await harness.prisma!.task.findMany({
      where: { id: { in: ['task_20', 'task_21'] }, ...taskHasSessions },
      select: { id: true },
    })
    expect(worked.map(t => t.id)).toEqual(['task_20'])
  })
})

describe('a steward bind clears earlier provisional tags (I2)', () => {
  it('nulls the tagged events of the root and its unbound children, moving open crossings to no task', async () => {
    await seedSession('SB')
    await seedSession('SB:a1', { parentSessionId: 'SB', agentId: 'a1' })
    // An explicitly attached child keeps its binding and its events.
    await seedSession('SB:a2', {
      parentSessionId: 'SB',
      agentId: 'a2',
      taskId: 'task_13',
      bindingSource: 'ATTACH',
    })
    await seedEvent('sb_root', 'SB', 'task_12')
    await seedEvent('sb_root_ruled', 'SB', 'task_12')
    await seedEvent('sb_child', 'SB:a1', 'task_12')
    await seedEvent('sb_bound_child', 'SB:a2', 'task_13')
    await seedCrossing('c_sb_open', 'sb_root', 'task_12', null)
    await seedCrossing('c_sb_ruled', 'sb_root_ruled', 'task_12', 'CONFIRMED')
    await seedCrossing('c_sb_child', 'sb_child', 'task_12', null)
    await seedCrossing('c_sb_bound', 'sb_bound_child', 'task_13', null)

    await sessionRepository.upsertWithMilestoneId({
      id: 'SB',
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      milestoneId: 'ms_1',
      now: t(5),
    })

    expect(await taskOf('hook_events', 'sb_root')).toBeNull()
    expect(await taskOf('hook_events', 'sb_root_ruled')).toBeNull()
    expect(await taskOf('hook_events', 'sb_child')).toBeNull()
    expect(await taskOf('hook_events', 'sb_bound_child')).toBe('task_13')
    expect(await taskOf('boundary_crossings', 'c_sb_open')).toBeNull()
    expect(await taskOf('boundary_crossings', 'c_sb_child')).toBeNull()
    expect(await taskOf('boundary_crossings', 'c_sb_ruled')).toBe('task_12')
    expect(await taskOf('boundary_crossings', 'c_sb_bound')).toBe('task_13')
  })
})

describe('POST events find their PRE_TOOL_USE by tool_use_id (I1a)', () => {
  it('findPreToolUseTask matches the payload tool_use_id within the session and window', async () => {
    await seedSession('PRE')
    await seedSession('PRE_OTHER')
    const pre = (id: string, sessionId: string, toolUseId: string, at: Date) =>
      seedEvent(id, sessionId, 'task_12', {
        payload: JSON.stringify({ tool_name: 'Bash', tool_use_id: toolUseId }),
        createdAt: at.toISOString(),
      })
    await pre('pre_hit', 'PRE', 'toolu_1', t(10))
    await pre('pre_other_session', 'PRE_OTHER', 'toolu_2', t(10))
    await pre('pre_old', 'PRE', 'toolu_3', t(0))
    // A POST row carrying the same id is not a PRE.
    await seedEvent('post_same', 'PRE', 'task_13', {
      type: 'POST_TOOL_USE',
      payload: JSON.stringify({ tool_use_id: 'toolu_4' }),
      createdAt: t(11).toISOString(),
    })
    const find = (sessionId: string, toolUseId: string) =>
      attributionRepository.findPreToolUseTask('ws', sessionId, toolUseId, t(5))
    await expect(find('PRE', 'toolu_1')).resolves.toBe('task_12')
    await expect(find('PRE', 'toolu_2')).resolves.toBeNull()
    await expect(find('PRE', 'toolu_3')).resolves.toBeNull()
    await expect(find('PRE', 'toolu_4')).resolves.toBeNull()
  })
})

describe('backfilled POST_TOOL_USE events get boundary detection (I1b)', () => {
  it('a recompute that moves a POST event from no task to a task replays the detector on its stored payload', async () => {
    await seedSession('RP')
    const at = (n: number) => ({ createdAt: t(20 + n).toISOString() })
    await seedEvent('rp_prompt', 'RP', null, {
      type: 'USER_PROMPT_SUBMIT',
      attributionSignals: JSON.stringify([]),
      ...at(0),
    })
    await seedEvent('rp_pre', 'RP', null, {
      attributionSignals: JSON.stringify([
        { kind: 'LUMO_CMD', identifier: 'LUM-12' },
      ]),
      ...at(1),
    })
    await seedEvent('rp_post', 'RP', null, {
      type: 'POST_TOOL_USE',
      payload: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'lumo task context LUM-12' },
      }),
      attributionSignals: JSON.stringify([]),
      ...at(2),
    })
    // Already on a task before the recompute: not replayed.
    await seedEvent('rp_post_tagged', 'RP', 'task_12', {
      type: 'POST_TOOL_USE',
      attributionSignals: JSON.stringify([]),
      ...at(3),
    })
    await seedEvent('rp_stop', 'RP', null, {
      type: 'STOP',
      attributionSignals: JSON.stringify([]),
      ...at(4),
    })

    await recomputeAttributionSafely('RP')

    expect(await taskOf('hook_events', 'rp_post')).toBe('task_12')
    expect(detectAndRecord).toHaveBeenCalledTimes(1)
    expect(detectAndRecord).toHaveBeenCalledWith({
      taskId: 'task_12',
      hookEventId: 'rp_post',
      toolName: null,
      filePath: null,
      payload: {
        tool_name: 'Bash',
        tool_input: { command: 'lumo task context LUM-12' },
      },
      // LUM-1114: the replayed session and the stored event's own time (the
      // seeded rp_post createdAt), never the replay's wall clock.
      sessionId: 'RP',
      occurredAt: t(22),
    })
  })
})

describe('crossing explain for an unattached session resolves the crossing session through its hook event (I3)', () => {
  it('a detector-shaped crossing (sessionId null, hookEventId set) from the caller own family can be explained', async () => {
    await seedSession('EX')
    await seedSession('EX:a1', { parentSessionId: 'EX', agentId: 'a1' })
    await seedSession('EX_OTHER')
    await seedEvent('ex_evt', 'EX:a1', 'task_12')
    await seedEvent('ex_other_evt', 'EX_OTHER', 'task_12')
    await seedCrossing('c_ex', 'ex_evt', 'task_12', null)
    await seedCrossing('c_ex_other', 'ex_other_evt', 'task_12', null)

    const out = await boundaryCrossingService.explain(
      'task_12',
      'c_ex',
      'ran it on purpose',
      { authorSessionId: 'EX', authorAgent: 'CLAUDE_CODE', memberId: 'member' }
    )
    expect(out.crossingId).toBe('c_ex')

    await expect(
      boundaryCrossingService.explain('task_12', 'c_ex_other', 'not mine', {
        authorSessionId: 'EX',
        authorAgent: 'CLAUDE_CODE',
        memberId: 'member',
      })
    ).rejects.toMatchObject({ status: 403 })
  })
})
