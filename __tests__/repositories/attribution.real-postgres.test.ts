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

  it('replaceFamilySegments round-trips and replaces the whole family', async () => {
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
    await attributionRepository.replaceFamilySegments(ids, [
      row({}),
      row({ sessionId: CHILD, source: 'INHERITED', confidence: 'EXPLICIT' }),
    ])
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

    await attributionRepository.replaceFamilySegments(ids, [
      row({ toTurn: 5, toAt: t(7) }),
    ])
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
