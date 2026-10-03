/**
 * @jest-environment node
 *
 * LUM-932 P2: the attribution repository against a REAL Postgres (every
 * migration replayed into PGlite). Only the database can show what
 * `attributionSignals: { equals: DbNull }` matches (SQL NULL vs JSON `[]`),
 * that a same-parent child in another workspace stays out of the family,
 * and that segments round-trip through the replace transaction.
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

import {
  ATTRIBUTION_COMPUTE_VERSION,
  attributionRepository,
  type SegmentRow,
} from '@/lib/repositories/attribution.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'

jest.setTimeout(180_000)

const ROOT = 'root-uuid'
const CHILD = `${ROOT}:a1`
const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s))

async function seedEvent(
  id: string,
  sessionId: string,
  createdAt: Date,
  extra: Record<string, unknown> = {},
  workspaceId = 'ws'
) {
  await harness.insert('hook_events', {
    id,
    workspaceId,
    workspaceMemberId: workspaceId === 'ws' ? 'member' : 'member-b',
    sessionId,
    type: 'PRE_TOOL_USE',
    payload: JSON.stringify({ tool_name: 'Bash', id }),
    createdAt: createdAt.toISOString(),
    ...extra,
  })
}

beforeAll(async () => {
  await harness.start()
  for (const [ws, member] of [
    ['ws', 'member'],
    ['ws-b', 'member-b'],
  ] as const) {
    await harness.insert('workspaces', { id: ws, name: ws, slug: ws })
    await harness.insert('workspace_members', {
      id: member,
      workspaceId: ws,
      clerkId: `clerk-${ws}`,
    })
  }
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
  await harness.insert('tasks', {
    id: 'task_12',
    projectId: 'project',
    teamId: 'team',
    number: 12,
    title: 'T',
  })

  const session = (id: string, extra: Record<string, unknown> = {}) =>
    harness.insert('sessions', {
      id,
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      startedAt: t(0).toISOString(),
      lastActivityAt: t(9).toISOString(),
      ...extra,
    })
  await session(ROOT)
  await session(CHILD, { parentSessionId: ROOT, agentId: 'a1' })
  // Same parent id, different workspace: never part of this family.
  await session(`${ROOT}:a2`, {
    workspaceId: 'ws-b',
    workspaceMemberId: 'member-b',
    parentSessionId: ROOT,
    agentId: 'a2',
  })

  // (a) never computed: SQL NULL signals, payload present.
  await seedEvent('e_a_null', ROOT, t(1))
  // (b) computed-empty: JSON [].
  await seedEvent('e_b_empty', ROOT, t(2), {
    attributionSignals: JSON.stringify([]),
  })
  // (c) stored signals.
  await seedEvent('e_c_signals', CHILD, t(3), {
    attributionSignals: JSON.stringify([
      { kind: 'LUMO_CMD', identifier: 'LUM-12' },
    ]),
  })
  // (d) SQL NULL signals but the payload was pruned.
  await seedEvent('e_d_pruned', ROOT, t(4), {
    payloadPrunedAt: t(8).toISOString(),
  })
  // Foreign-workspace child's event.
  await seedEvent('e_foreign', `${ROOT}:a2`, t(5), {}, 'ws-b')
})

afterAll(async () => {
  await harness.stop()
})

describe('attribution repository on a real Postgres', () => {
  it('loadFamily returns payloads only for never-computed unpruned events and excludes a foreign-workspace child', async () => {
    const fam = await attributionRepository.loadFamily(ROOT)
    expect(fam).not.toBeNull()
    expect(fam!.workspaceId).toBe('ws')
    expect(fam!.sessions.map(s => s.id)).toEqual([ROOT, CHILD])
    expect(
      fam!.events.map(e => [e.id, e.payload === null ? null : 'payload'])
    ).toEqual([
      ['e_a_null', 'payload'],
      ['e_b_empty', null],
      ['e_c_signals', null],
      ['e_d_pruned', null],
    ])
    const byId = new Map(fam!.events.map(e => [e.id, e]))
    expect(byId.get('e_a_null')!.attributionSignals).toBeNull()
    expect(byId.get('e_b_empty')!.attributionSignals).toEqual([])
    expect(byId.get('e_c_signals')!.attributionSignals).toEqual([
      { kind: 'LUMO_CMD', identifier: 'LUM-12' },
    ])
    expect(byId.get('e_d_pruned')!.payloadPrunedAt).toEqual(t(8))
  })

  it('commitFamilyAttribution round-trips segments and replaces the whole family', async () => {
    const row = (over: Partial<SegmentRow>): SegmentRow => ({
      workspaceId: 'ws',
      sessionId: ROOT,
      taskId: 'task_12',
      fromTurn: 0,
      toTurn: 2,
      fromAt: t(1),
      toAt: null,
      source: 'INFERRED',
      confidence: 'HIGH',
      evidence: [
        { kind: 'LUMO_CMD', identifier: 'LUM-12', at: t(3).toISOString() },
      ],
      computeVersion: ATTRIBUTION_COMPUTE_VERSION,
      ...over,
    })
    const ids = [ROOT, CHILD]
    const commit = async (segments: SegmentRow[]) => {
      const fam = await attributionRepository.loadFamily(ROOT)
      return attributionRepository.commitFamilyAttribution({
        rootSessionId: ROOT,
        expectedVersion: fam!.attributionVersion,
        familyIds: ids,
        segments,
        eventTaskChanges: [],
      })
    }
    await expect(
      commit([
        row({}),
        row({ sessionId: CHILD, source: 'INHERITED', confidence: 'EXPLICIT' }),
      ])
    ).resolves.toMatchObject({
      conflict: false,
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    const sortById = <T extends { sessionId: string }>(xs: T[]) =>
      [...xs].sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    const stored = sortById(await attributionRepository.listFamilySegments(ids))
    // ROOT sorts before `${ROOT}:a1`.
    expect(stored).toEqual([
      {
        sessionId: ROOT,
        taskId: 'task_12',
        fromTurn: 0,
        toTurn: 2,
        fromAt: t(1),
        toAt: null,
        source: 'INFERRED',
        confidence: 'HIGH',
        computeVersion: ATTRIBUTION_COMPUTE_VERSION,
        evidence: [
          { kind: 'LUMO_CMD', identifier: 'LUM-12', at: t(3).toISOString() },
        ],
      },
      expect.objectContaining({
        sessionId: CHILD,
        source: 'INHERITED',
        confidence: 'EXPLICIT',
      }),
    ])

    await commit([row({ toTurn: 5, toAt: t(7) })])
    expect(await attributionRepository.listFamilySegments(ids)).toEqual([
      expect.objectContaining({ sessionId: ROOT, toTurn: 5, toAt: t(7) }),
    ])
  })

  it('loadBoundFamilyShape counts root prompts and first event times without the foreign child', async () => {
    expect(await attributionRepository.loadBoundFamilyShape(ROOT)).toBeNull()
    await harness.query(
      `update sessions set "taskId" = 'task_12', "bindingSource" = 'ATTACH' where id = $1`,
      [ROOT]
    )
    await seedEvent('e_prompt1', ROOT, t(6), { type: 'USER_PROMPT_SUBMIT' })
    await seedEvent('e_prompt2', ROOT, t(7), { type: 'USER_PROMPT_SUBMIT' })
    const shape = await attributionRepository.loadBoundFamilyShape(ROOT)
    expect(shape).toEqual({
      workspaceId: 'ws',
      // Bumped by the earlier commits in this file.
      attributionVersion: expect.any(Number),
      sessions: [
        expect.objectContaining({ id: ROOT, taskId: 'task_12' }),
        expect.objectContaining({ id: CHILD }),
      ],
      rootPromptCount: 2,
      firstEventAt: new Map([
        [ROOT, t(1)],
        [CHILD, t(3)],
      ]),
    })
  })
})

describe('commitFamilyAttribution on a real Postgres (LUM-932 P3)', () => {
  const FAM = 'fam-root'
  const FAM_CHILD = `${FAM}:a1`
  const FAM_IDS = [FAM, FAM_CHILD]
  const EVENTS = ['f_e1', 'f_e2', 'f_e3', 'f_child']

  beforeAll(async () => {
    await harness.insert('tasks', {
      id: 'task_13',
      projectId: 'project',
      teamId: 'team',
      number: 13,
      title: 'T13',
    })
    for (const [id, extra] of [
      [FAM, {}],
      [FAM_CHILD, { parentSessionId: FAM, agentId: 'a1' }],
    ] as const) {
      await harness.insert('sessions', {
        id,
        workspaceId: 'ws',
        workspaceMemberId: 'member',
        startedAt: t(0).toISOString(),
        lastActivityAt: t(9).toISOString(),
        attributionVersion: 4,
        ...extra,
      })
    }
    for (const [i, id] of EVENTS.entries()) {
      await seedEvent(id, id === 'f_child' ? FAM_CHILD : FAM, t(i + 1), {
        taskId: 'task_12',
      })
    }
    const crossing = (id: string, extra: Record<string, unknown>) =>
      harness.insert('boundary_crossings', {
        id,
        taskId: 'task_12',
        category: 'NEW_NPM_DEPENDENCY',
        detail: id,
        ...extra,
      })
    await crossing('x_open', { hookEventId: 'f_e1' })
    await crossing('x_ruled', {
      hookEventId: 'f_e2',
      disposition: 'CONFIRMED',
      dispositionedAt: t(9).toISOString(),
    })
    // Same task, an event outside the change set: stays.
    await crossing('x_other', { hookEventId: 'f_e3' })
  })

  const eventTasks = async () =>
    harness.query<{ id: string; taskId: string | null }>(
      `select id, "taskId" from hook_events where id = any($1) order by id`,
      [EVENTS]
    )
  const crossingTasks = async () =>
    harness.query<{ id: string; taskId: string | null }>(
      `select id, "taskId" from boundary_crossings where id like 'x_%' order by id`
    )
  const version = async () =>
    (
      await harness.query<{ attributionVersion: number }>(
        `select "attributionVersion" from sessions where id = $1`,
        [FAM]
      )
    )[0]!.attributionVersion
  const changes = [
    { eventId: 'f_e1', taskId: 'task_13' },
    { eventId: 'f_e2', taskId: 'task_13' },
    { eventId: 'f_child', taskId: 'task_13' },
  ]

  it('a version mismatch reports a conflict and writes nothing', async () => {
    const before = [await eventTasks(), await crossingTasks()]
    await expect(
      attributionRepository.commitFamilyAttribution({
        rootSessionId: FAM,
        expectedVersion: 3,
        familyIds: FAM_IDS,
        segments: [],
        eventTaskChanges: changes,
      })
    ).resolves.toMatchObject({
      conflict: true,
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    expect([await eventTasks(), await crossingTasks()]).toEqual(before)
    expect(await version()).toBe(4)
  })

  it('retags events, moves the undispositioned crossing and leaves the ruled one', async () => {
    await expect(
      attributionRepository.commitFamilyAttribution({
        rootSessionId: FAM,
        expectedVersion: 4,
        familyIds: FAM_IDS,
        segments: null,
        eventTaskChanges: changes,
      })
    ).resolves.toEqual({
      conflict: false,
      eventsUpdated: 3,
      crossingsMoved: 1,
      crossingsMovedToNull: 0,
      changedEvents: expect.arrayContaining([
        { eventId: 'f_e1', fromTaskId: 'task_12', toTaskId: 'task_13' },
        { eventId: 'f_e2', fromTaskId: 'task_12', toTaskId: 'task_13' },
        { eventId: 'f_child', fromTaskId: 'task_12', toTaskId: 'task_13' },
      ]),
    })
    expect(await version()).toBe(5)
    expect(await eventTasks()).toEqual([
      { id: 'f_child', taskId: 'task_13' },
      { id: 'f_e1', taskId: 'task_13' },
      { id: 'f_e2', taskId: 'task_13' },
      { id: 'f_e3', taskId: 'task_12' },
    ])
    expect(await crossingTasks()).toEqual([
      { id: 'x_open', taskId: 'task_13' },
      { id: 'x_other', taskId: 'task_12' },
      { id: 'x_ruled', taskId: 'task_12' },
    ])
  })

  it('a session bound since the load keeps its events (explicit wins)', async () => {
    await harness.query(
      `update sessions set "taskId" = 'task_12', "bindingSource" = 'ATTACH' where id = $1`,
      [FAM_CHILD]
    )
    await expect(
      attributionRepository.commitFamilyAttribution({
        rootSessionId: FAM,
        expectedVersion: 5,
        familyIds: FAM_IDS,
        segments: null,
        eventTaskChanges: [
          { eventId: 'f_e1', taskId: null },
          { eventId: 'f_child', taskId: null },
        ],
      })
    ).resolves.toEqual({
      conflict: false,
      eventsUpdated: 1,
      crossingsMoved: 1,
      // M1: the open crossing went to no task with its event.
      crossingsMovedToNull: 1,
      changedEvents: [
        { eventId: 'f_e1', fromTaskId: 'task_13', toTaskId: null },
      ],
    })
    expect(await eventTasks()).toEqual([
      { id: 'f_child', taskId: 'task_13' },
      { id: 'f_e1', taskId: null },
      { id: 'f_e2', taskId: 'task_13' },
      { id: 'f_e3', taskId: 'task_12' },
    ])
    // The open crossing follows its event to "no task".
    expect(await crossingTasks()).toContainEqual({ id: 'x_open', taskId: null })
  })
})

describe('bindings serialize with the recompute via the root version (LUM-932 P3)', () => {
  const seedFamily = async (root: string, prefix: string) => {
    for (const [id, extra] of [
      [root, {}],
      [`${root}:a1`, { parentSessionId: root, agentId: 'a1' }],
    ] as const) {
      await harness.insert('sessions', {
        id,
        workspaceId: 'ws',
        workspaceMemberId: 'member',
        startedAt: t(0).toISOString(),
        lastActivityAt: t(9).toISOString(),
        ...extra,
      })
    }
    await seedEvent(`${prefix}_root`, root, t(1), { taskId: 'task_12' })
    await seedEvent(`${prefix}_child`, `${root}:a1`, t(2), {
      taskId: 'task_12',
    })
  }
  const tasksOf = async (prefix: string) =>
    harness.query<{ id: string; taskId: string | null }>(
      `select id, "taskId" from hook_events where id like $1 order by id`,
      [`${prefix}_%`]
    )
  const versionOf = async (id: string) =>
    (
      await harness.query<{ attributionVersion: number }>(
        `select "attributionVersion" from sessions where id = $1`,
        [id]
      )
    )[0]!.attributionVersion
  const toNull = (prefix: string) => [
    { eventId: `${prefix}_root`, taskId: null },
    { eventId: `${prefix}_child`, taskId: null },
  ]

  beforeAll(async () => {
    await harness.insert('milestones', {
      id: 'ms_1',
      projectId: 'project',
      name: 'M1',
      slug: 'm1',
    })
  })

  it('a child attach after the load bumps the root, so the commit conflicts and writes nothing', async () => {
    const ROOT_S = 'ser-root'
    await seedFamily(ROOT_S, 'sa')
    const fam = await attributionRepository.loadFamily(ROOT_S)
    const v = fam!.attributionVersion
    await sessionRepository.upsertWithTaskId({
      id: `${ROOT_S}:a1`,
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      taskId: 'task_12',
      parentSessionId: ROOT_S,
      agentId: 'a1',
      now: t(5),
    })
    expect(await versionOf(ROOT_S)).toBe(v + 1)
    await expect(
      attributionRepository.commitFamilyAttribution({
        rootSessionId: ROOT_S,
        expectedVersion: v,
        familyIds: [ROOT_S, `${ROOT_S}:a1`],
        segments: [],
        eventTaskChanges: toNull('sa'),
      })
    ).resolves.toMatchObject({
      conflict: true,
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    expect(await tasksOf('sa')).toEqual([
      { id: 'sa_child', taskId: 'task_12' },
      { id: 'sa_root', taskId: 'task_12' },
    ])
  })

  it('a steward attach after the load bumps the root, so the commit conflicts and writes nothing', async () => {
    const ROOT_S = 'stw-root'
    await seedFamily(ROOT_S, 'sb')
    const fam = await attributionRepository.loadFamily(ROOT_S)
    const v = fam!.attributionVersion
    await sessionRepository.upsertWithMilestoneId({
      id: ROOT_S,
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      milestoneId: 'ms_1',
      now: t(5),
    })
    expect(await versionOf(ROOT_S)).toBe(v + 1)
    await expect(
      attributionRepository.commitFamilyAttribution({
        rootSessionId: ROOT_S,
        expectedVersion: v,
        familyIds: [ROOT_S, `${ROOT_S}:a1`],
        segments: [],
        eventTaskChanges: toNull('sb'),
      })
    ).resolves.toMatchObject({
      conflict: true,
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    // The steward bind itself cleared the provisional tags (LUM-640: a
    // steward family stays task-less); the stale commit wrote nothing.
    expect(await tasksOf('sb')).toEqual([
      { id: 'sb_child', taskId: null },
      { id: 'sb_root', taskId: null },
    ])
  })

  it('the in-transaction re-check never backfills a STEWARD root or its child', async () => {
    const ROOT_S = 'stw-recheck'
    await seedFamily(ROOT_S, 'sc')
    // Steward without a version bump: only the re-check stands in the way.
    await harness.query(
      `update sessions set role = 'STEWARD', "milestoneId" = 'ms_1' where id = $1`,
      [ROOT_S]
    )
    const fam = await attributionRepository.loadFamily(ROOT_S)
    await expect(
      attributionRepository.commitFamilyAttribution({
        rootSessionId: ROOT_S,
        expectedVersion: fam!.attributionVersion,
        familyIds: [ROOT_S, `${ROOT_S}:a1`],
        segments: null,
        eventTaskChanges: toNull('sc'),
      })
    ).resolves.toMatchObject({
      conflict: false,
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    expect(await tasksOf('sc')).toEqual([
      { id: 'sc_child', taskId: 'task_12' },
      { id: 'sc_root', taskId: 'task_12' },
    ])
  })
})

describe('task-notification payloads on a real Postgres', () => {
  it('loadFamily also returns the payload of a root task-notification prompt whose signals were already stored', async () => {
    const R = 'root-notify'
    await harness.insert('sessions', {
      id: R,
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      startedAt: t(0).toISOString(),
      lastActivityAt: t(9).toISOString(),
    })
    const prompt = (id: string, text: string, at: number) =>
      seedEvent(id, R, t(at), {
        type: 'USER_PROMPT_SUBMIT',
        payload: JSON.stringify({ prompt: text }),
        attributionSignals: JSON.stringify([]),
      })
    await prompt(
      'n_notify',
      '<task-notification>\n<task-id>a1</task-id>\n</task-notification>',
      1
    )
    await prompt('n_plain', 'just a prompt', 2)
    await seedEvent('n_tool', R, t(3), {
      payload: JSON.stringify({ prompt: '<task-notification>' }),
      attributionSignals: JSON.stringify([]),
    })
    const fam = await attributionRepository.loadFamily(R)
    expect(
      fam!.events.map(e => [e.id, e.payload === null ? null : 'payload'])
    ).toEqual([
      ['n_notify', 'payload'],
      ['n_plain', null],
      ['n_tool', null],
    ])
  })
})
