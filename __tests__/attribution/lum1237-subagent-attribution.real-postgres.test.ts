/**
 * @jest-environment node
 *
 * LUM-1237 end-to-end repro against a REAL Postgres (every migration
 * replayed): an UNBOUND parent session starts two background subagents
 * (`run_in_background`), each runs `lumo session attach` for its own task and
 * works for a few minutes, the parent only orchestrates (task-notification
 * turns, a task-naming `lumo` read). Hook payloads use the shapes Claude Code
 * really sends (subagent tool events carry `agent_id` + the PARENT
 * `session_id`; SubagentStart has no tool_use_id; the parent STOP's
 * `_lumo_usage` totals include the subagent transcripts and list them under
 * `bySubagent`). They are replayed through the real hook-event service,
 * attach service and attribution recompute; `createdAt` is set to a simulated
 * clock after each insert.
 *
 * Expected: each task shows `1 bound`, active time within 10% of its
 * subagent's real run time, tokens = only that subagent's usage, and the
 * orchestrating parent lands on no task (time, tokens, events).
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
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  enrichClerkUsers: jest.fn(
    async (ids: string[]) =>
      new Map(ids.map(id => [id, { name: `Name ${id}`, imageUrl: '' }]))
  ),
  lookupClerkProfiles: jest.fn(async () => new Map()),
}))
// Attach's context sections are not under test.
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildMemorySectionForTask: jest.fn(async () => ''),
    buildTestCaseSectionForTask: jest.fn(async () => ''),
    buildPreviousSessionRecoveryForTask: jest.fn(async () => null),
  },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {
    buildBlockerWarningSectionForTask: jest.fn(async () => ''),
  },
}))
jest.mock('@/lib/plugins/agent-context', () => ({
  collectSessionStartSections: jest.fn(async () => ''),
}))
jest.mock('@/lib/integrations/github', () => ({}))
jest.mock('@/lib/services/progress.service', () => ({
  progressService: { getProgress: jest.fn(async () => null) },
}))

import type { HookEventType, Prisma } from '@prisma/client'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionService } from '@/lib/services/session.service'
import { attributionService } from '@/lib/services/attribution.service'
import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { agentRunReportService } from '@/lib/services/agent-run-report.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { computeMilestoneDeliveryStats } from '@/lib/summaries/milestone-delivery-stats'
import { computeSprintTeamPerformance } from '@/lib/summaries/sprint-team-performance'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

jest.setTimeout(180_000)

const WS = 'ws_lum1237'
const CLERK = 'clerk_lum1237'
const MEMBER = 'm_lum1237'
const T1 = 'task_lum1237_1'
const T2 = 'task_lum1237_2'
const PARENT = '6d0c6c1e-1237-4c4c-9a9a-000000001237'
const A1 = 'a1237aaaaaaaaaaaa'
const A2 = 'a1237bbbbbbbbbbbb'
const MODEL = 'claude-opus-5-5'
const T0 = Date.UTC(2026, 9, 18, 9, 0, 0)
const sec = (s: number) => new Date(T0 + s * 1000)

const identity: VerifyApiKeyResult = {
  user: { id: CLERK },
  workspace: { id: WS, slug: 'lum1237', name: 'lum1237' },
  apiKey: { id: 'k', name: 'k', prefix: 'k' },
}
const db = () => harness.prisma!

function usage(total: number) {
  return {
    inputTokens: total / 10,
    outputTokens: total / 10,
    cacheReadTokens: (total * 7) / 10,
    cacheCreationTokens: total / 10,
    byModel: {
      [MODEL]: {
        input: total / 10,
        output: total / 10,
        cacheRead: (total * 7) / 10,
        cacheCreation: total / 10,
      },
    },
  }
}

type Step =
  | {
      at: number
      kind: 'hook'
      type: HookEventType
      payload: Record<string, unknown>
      /** Simulate the boundary detector filing a crossing on this event. */
      crossing?: string
    }
  | { at: number; kind: 'attach'; sessionId: string; task: string }

const steps: Step[] = []
let toolSeq = 0
const parentEv = (
  at: number,
  type: HookEventType,
  extra: Record<string, unknown> = {},
  crossing?: string
) =>
  steps.push({
    at,
    kind: 'hook',
    type,
    payload: {
      session_id: PARENT,
      cwd: '/repo',
      _lumo_branch: 'main',
      ...extra,
    },
    ...(crossing ? { crossing } : {}),
  })
const childEv = (
  agentId: string,
  at: number,
  type: HookEventType,
  extra: Record<string, unknown> = {}
) =>
  steps.push({
    at,
    kind: 'hook',
    type,
    payload: {
      session_id: PARENT,
      agent_id: agentId,
      agent_type: 'general-purpose',
      cwd: `/repo/.worktrees/${agentId}`,
      ...extra,
    },
  })
const childBash = (agentId: string, at: number, command: string) => {
  const id = `toolu_${++toolSeq}`
  const tool = { tool_name: 'Bash', tool_input: { command }, tool_use_id: id }
  childEv(agentId, at, 'PRE_TOOL_USE', tool)
  childEv(agentId, at + 1, 'POST_TOOL_USE', {
    ...tool,
    tool_response: { stdout: 'ok' },
  })
}

/** A background subagent that attaches `task` and works `[start, stop]`. */
function subagent(agentId: string, task: string, start: number, stop: number) {
  childEv(agentId, start, 'SUBAGENT_START')
  childBash(agentId, start + 5, `lumo session attach ${task}`)
  steps.push({
    at: start + 5.5,
    kind: 'attach',
    sessionId: `${PARENT}:${agentId}`,
    task,
  })
  for (let t = start + 30; t < stop - 5; t += 30) {
    childBash(agentId, t, `npx jest __tests__/${agentId}.test.ts`)
  }
  childEv(agentId, stop, 'SUBAGENT_STOP', {
    agent_transcript_path: `/x/${PARENT}/subagents/agent-${agentId}.jsonl`,
    last_assistant_message: 'done',
  })
}

const dispatch = (at: number, agentId: string, task: string) => {
  const tool = {
    tool_name: 'Agent',
    tool_use_id: `toolu_${++toolSeq}`,
    tool_input: {
      description: `Implement ${task}`,
      prompt: `You own ${task}. First run \`lumo session attach ${task}\`.`,
      subagent_type: 'general-purpose',
      run_in_background: true,
    },
  }
  parentEv(at, 'PRE_TOOL_USE', tool)
  parentEv(at + 1, 'POST_TOOL_USE', {
    ...tool,
    tool_response: { isAsync: true, status: 'async_launched', agentId },
  })
}

const PARENT_OWN = 2_000
const A1_TOKENS = 50_000
const A2_TOKENS = 40_000
const A1_RUN = { start: 4, stop: 304 } // 5 min
const A2_RUN = { start: 6, stop: 246 } // 4 min

function scenario() {
  parentEv(0, 'USER_PROMPT_SUBMIT', {
    prompt: '用两个后台 subagent 并行做 LUM-1 和 LUM-2,各自 attach。',
  })
  // Before any subagent attached, a task-naming read of the parent is
  // provisionally tagged and a crossing is filed on it.
  parentEv(
    1,
    'PRE_TOOL_USE',
    {
      tool_name: 'Bash',
      tool_use_id: 'toolu_p0',
      tool_input: { command: 'lumo task show LUM-1' },
    },
    'cr_early'
  )
  dispatch(2, A1, 'LUM-1')
  dispatch(4, A2, 'LUM-2')
  parentEv(8, 'STOP', { _lumo_usage: usage(PARENT_OWN / 2) })
  subagent(A1, 'LUM-1', A1_RUN.start, A1_RUN.stop)
  subagent(A2, 'LUM-2', A2_RUN.start, A2_RUN.stop)
  // The parent wakes on each completion notice and only orchestrates.
  const total = {
    ...usage(PARENT_OWN + A1_TOKENS + A2_TOKENS),
    bySubagent: { [A1]: usage(A1_TOKENS), [A2]: usage(A2_TOKENS) },
  }
  parentEv(250, 'USER_PROMPT_SUBMIT', {
    prompt: `<task-notification>\n<task-id>${A2}</task-id>\n<status>completed</status>\n</task-notification>`,
  })
  parentEv(252, 'PRE_TOOL_USE', {
    tool_name: 'Bash',
    tool_use_id: 'toolu_p1',
    tool_input: { command: 'lumo task runs LUM-2' },
  })
  parentEv(253, 'POST_TOOL_USE', {
    tool_name: 'Bash',
    tool_use_id: 'toolu_p1',
    tool_input: { command: 'lumo task runs LUM-2' },
  })
  parentEv(260, 'STOP', {
    _lumo_usage: {
      ...usage(PARENT_OWN * 0.75 + A2_TOKENS),
      bySubagent: { [A2]: usage(A2_TOKENS) },
    },
  })
  parentEv(310, 'USER_PROMPT_SUBMIT', {
    prompt: `<task-notification>\n<task-id>${A1}</task-id>\n<status>completed</status>\n</task-notification>`,
  })
  parentEv(
    312,
    'PRE_TOOL_USE',
    {
      tool_name: 'Bash',
      tool_use_id: 'toolu_p2',
      tool_input: { command: 'lumo task runs LUM-1' },
    },
    'cr_late'
  )
  parentEv(313, 'POST_TOOL_USE', {
    tool_name: 'Bash',
    tool_use_id: 'toolu_p2',
    tool_input: { command: 'lumo task runs LUM-1' },
  })
  parentEv(320, 'STOP', { _lumo_usage: total })
}

const crossingTaskAtCreation = new Map<string, string | null>()

async function replay() {
  const ordered = steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.at - b.s.at || a.i - b.i)
    .map(x => x.s)
  for (const step of ordered) {
    if (step.kind === 'attach') {
      await sessionService.bindSessionToTask({
        identity,
        sessionId: step.sessionId,
        taskIdentifier: step.task,
      })
      await attributionService.recomputeFamily(step.sessionId)
      continue
    }
    const rec = await hookEventService.recordHookEvent({
      identity,
      type: step.type,
      payload: step.payload as Prisma.InputJsonValue,
    })
    await db().hookEvent.update({
      where: { id: rec.id },
      data: { createdAt: sec(step.at) },
    })
    if (step.crossing) {
      crossingTaskAtCreation.set(step.crossing, rec.taskId)
      await db().boundaryCrossing.create({
        data: {
          id: step.crossing,
          workspaceId: WS,
          taskId: rec.taskId,
          hookEventId: rec.id,
          sessionId: rec.sessionId,
          category: 'DESTRUCTIVE_DB_COMMAND',
          detail: 'simulated',
        },
      })
    }
    // Production recomputes after every STOP / SUBAGENT_STOP.
    if (step.type === 'STOP' || step.type === 'SUBAGENT_STOP') {
      await attributionService.recomputeFamily(rec.sessionId ?? PARENT)
    }
  }
}

beforeAll(async () => {
  await harness.start()
  await db().workspace.create({
    data: { id: WS, name: WS, slug: 'lum1237' },
  })
  await db().workspaceMember.create({
    data: { id: MEMBER, workspaceId: WS, clerkId: CLERK, role: 'OWNER' },
  })
  await db().team.create({
    data: { id: 'team_lum1237', workspaceId: WS, name: 'L', identifier: 'LUM' },
  })
  await db().project.create({
    data: {
      id: 'proj_lum1237',
      workspaceId: WS,
      teamId: 'team_lum1237',
      createdByMemberId: MEMBER,
      name: 'p',
    },
  })
  for (const [id, number] of [
    [T1, 1],
    [T2, 2],
  ] as const) {
    await db().task.create({
      data: {
        id,
        projectId: 'proj_lum1237',
        workspaceId: WS,
        teamId: 'team_lum1237',
        number,
        title: `task ${number}`,
      },
    })
  }
  scenario()
  await replay()
})

afterAll(async () => {
  await harness.stop()
})

const within10 = (actualMs: number, expectedMs: number) =>
  Math.abs(actualMs - expectedMs) <= expectedMs * 0.1

describe('LUM-1237 two background subagents under an orchestrating parent', () => {
  it.each([
    [T1, A1_RUN, A1_TOKENS],
    [T2, A2_RUN, A2_TOKENS],
  ])(
    '%s: 1 bound, active time ≈ the subagent run, only its tokens',
    async (taskId, run, tokens) => {
      const report = await agentRunReportService.getReport(taskId)
      expect(report.overview.sessions).toEqual({ explicit: 1, inferred: 0 })
      expect(report.runs).toHaveLength(1)
      const expectedMs = (run.stop - run.start) * 1000
      expect(within10(report.runs[0]!.durationMs, expectedMs)).toBe(true)
      // Every in-run gap is < 5 min, so the whole subagent run counts.
      expect(report.runs[0]!.durationMs).toBe(expectedMs)
      expect(report.runs[0]!.attribution?.mode).toBe('HOST')
      expect(report.totals.total).toBe(tokens)

      const actuals = await retrospectiveRepository.loadActuals(taskId)
      expect(actuals!.tokenCost).toBe(tokens)
      expect(actuals!.iterations).toBe(1)
      expect(within10(actuals!.totalDurationSec * 1000, expectedMs)).toBe(true)
    }
  )

  it('the orchestrating parent is on no task: no inferred segment, no tagged event', async () => {
    const segments = await db().taskAttributionSegment.findMany({
      where: { sessionId: PARENT },
    })
    expect(segments).toEqual([])
    const tagged = await db().hookEvent.count({
      where: { sessionId: PARENT, taskId: { not: null } },
    })
    expect(tagged).toBe(0)
    expect(await attributionRepository.hasSelfAttachedChild(WS, PARENT)).toBe(
      true
    )
  })

  it('crossings of the orchestrating parent follow it to no task', async () => {
    // Filed on LUM-1 while the parent did not host an attached subagent yet…
    expect(crossingTaskAtCreation.get('cr_early')).toBe(T1)
    // …and on no task once it did (record-time provisional tag).
    expect(crossingTaskAtCreation.get('cr_late')).toBeNull()
    const rows = await db().boundaryCrossing.findMany({
      where: { id: { in: ['cr_early', 'cr_late'] } },
      select: { id: true, taskId: true },
      orderBy: { id: 'asc' },
    })
    expect(rows).toEqual([
      { id: 'cr_early', taskId: null },
      { id: 'cr_late', taskId: null },
    ])
  })

  it('milestone and sprint rollups count each subagent on its own task, parent tokens once', async () => {
    const rows = await retrospectiveRepository.loadMemberActualRowsForTasks([
      T1,
      T2,
    ])
    const stats = computeMilestoneDeliveryStats({
      taskIds: [T1, T2],
      prRows: [],
      complexityRows: [],
      sessionRows: rows.sessions,
      turnEvents: rows.turnEvents,
      memberLabels: new Map(),
    })
    const byTask = new Map(stats.perTask.rows.map(r => [r.taskId, r]))
    expect(byTask.get(T1)?.tokenCost).toBe(A1_TOKENS)
    expect(byTask.get(T2)?.tokenCost).toBe(A2_TOKENS)
    expect(within10(byTask.get(T1)!.activeTimeSec * 1000, 300_000)).toBe(true)
    expect(within10(byTask.get(T2)!.activeTimeSec * 1000, 240_000)).toBe(true)
    expect(stats.perTask.unattributedActiveTimeSec).toBe(0)
    expect(stats.perMember.tokenCost).toBe(A1_TOKENS + A2_TOKENS)

    const sprint = computeSprintTeamPerformance({
      taskRows: [T1, T2].map((id, i) => ({
        id,
        identifier: `LUM-${i + 1}`,
        title: id,
        status: 'DONE' as const,
        priority: null,
        updatedAt: sec(400),
      })),
      sessionRows: rows.sessions,
      turnEvents: rows.turnEvents,
      memberLabels: new Map(),
    })
    const member = sprint.rows.find(r => r.memberId === MEMBER)!
    expect(member.tokenCost).toBe(A1_TOKENS + A2_TOKENS)
    expect(within10(member.activeTimeSec * 1000, 540_000)).toBe(true)
    expect(member.runs).toBe(1)
  })
})

describe('LUM-1237 history recompute (dry-run preview, then write)', () => {
  it('a family stored under the old rules is listed, previewed and fixed', async () => {
    // Re-create the pre-fix state: a stale v2 INFERRED root segment and a
    // parent event (with an open crossing) tagged to LUM-1.
    const ev = await db().hookEvent.findFirstOrThrow({
      where: { sessionId: PARENT, type: 'USER_PROMPT_SUBMIT' },
      orderBy: { createdAt: 'asc' },
    })
    await db().hookEvent.update({ where: { id: ev.id }, data: { taskId: T1 } })
    await db().boundaryCrossing.create({
      data: {
        id: 'cr_hist',
        workspaceId: WS,
        taskId: T1,
        hookEventId: ev.id,
        sessionId: PARENT,
        category: 'DESTRUCTIVE_DB_COMMAND',
        detail: 'historical',
      },
    })
    await db().taskAttributionSegment.create({
      data: {
        workspaceId: WS,
        sessionId: PARENT,
        taskId: T1,
        fromTurn: 0,
        toTurn: 2,
        fromAt: sec(0),
        toAt: null,
        source: 'INFERRED',
        confidence: 'HIGH',
        evidence: [],
        computeVersion: 2,
      },
    })

    expect(
      await attributionRepository.listOrchestrationHostRootIds({
        workspaceId: WS,
        limit: 10,
      })
    ).toEqual([PARENT])
    expect(
      await attributionRepository.listOrchestrationHostRootIds({
        workspaceId: 'other',
        limit: 10,
      })
    ).toEqual([])

    expect(await attributionService.previewFamily(PARENT)).toEqual({
      rootSessionId: PARENT,
      segmentsChanged: true,
      rootTasksBefore: [T1],
      rootTasksAfter: [],
      eventsRetagged: 1,
      eventsToNoTask: 1,
      openCrossingsMoved: 1,
    })
    // The preview wrote nothing.
    expect(
      await db().boundaryCrossing.findUniqueOrThrow({
        where: { id: 'cr_hist' },
      })
    ).toMatchObject({ taskId: T1 })

    const res = await attributionService.recomputeFamily(PARENT)
    expect(res).toMatchObject({
      written: true,
      eventsUpdated: 1,
      crossingsMoved: 1,
    })
    expect(
      await db().boundaryCrossing.findUniqueOrThrow({
        where: { id: 'cr_hist' },
      })
    ).toMatchObject({ taskId: null })
    expect(await attributionService.previewFamily(PARENT)).toMatchObject({
      segmentsChanged: false,
      eventsRetagged: 0,
    })
    expect(
      await attributionRepository.countOpenCrossingsForEvents([ev.id])
    ).toBe(1)
  })
})
