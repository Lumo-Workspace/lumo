/**
 * @jest-environment node
 *
 * LUM-1051 — the server ingests the real Codex payloads (LUM-1050 probe,
 * codex-cli 0.162.0, sanitized): every field validates as is, a subagent's
 * events land on its `<sid>:<agent_id>` child session, apply_patch is indexed
 * by its file, and a Codex STOP settles subagent usage onto the children.
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    createHookEvent: jest.fn(async () => ({ id: 'he_1' })),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertForHookEvent: jest.fn(async () => ({
      taskId: null,
      turnUsageByModel: null,
    })),
    upsertChildForHookEvent: jest.fn(async () => ({
      id: 'child',
      taskId: null,
      steward: false,
    })),
    settleChildUsage: jest.fn(async () => ({ settled: true })),
  },
}))
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    findOpenSegmentTask: jest.fn(async () => null),
    resolveIdentifiers: jest.fn(async () => new Map()),
    taskIdsForBranches: jest.fn(async () => new Map()),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn(async () => 'wm_1') },
}))

import type { HookEventType } from '@prisma/client'
import { validateHookPayload } from '@/lib/validation/hook-payload'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'
import payloads from '../fixtures/codex-hooks/payloads.json'

type Fixture = { event: string; payload: Record<string, unknown> }
const FIXTURES = payloads as Fixture[]

/** Codex event name → HookEventType (PreCompact → PRE_COMPACT). */
const typeOf = (event: string) =>
  event.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() as HookEventType

const identity = {
  user: { id: 'u_1' },
  workspace: { id: 'ws_1' },
} as unknown as VerifyApiKeyResult

const ROOT = '01a11e00-83c8-7ce3-b89d-eb1a44e13f3d'
const SUB = '01a11e00-aba8-7df2-9b0b-98c78d214c73'

beforeEach(() => jest.clearAllMocks())

describe('validateHookPayload accepts every probed Codex payload unchanged', () => {
  it.each(FIXTURES.map(f => [f.event, f.payload.tool_name ?? '', f] as const))(
    '%s %s',
    (event, _tool, f) => {
      const result = validateHookPayload(typeOf(event), f.payload)
      expect(result.dropped).toEqual([])
      expect(result.modified).toBe(false)
    }
  )
})

describe('hookEventService.recordHookEvent on Codex payloads', () => {
  const record = (f: Fixture) =>
    hookEventService.recordHookEvent({
      identity,
      type: typeOf(f.event),
      payload: f.payload as never,
      agent: 'CODEX',
    })

  it('subagent events go to the child session keyed by agent_id', async () => {
    const sub = FIXTURES.filter(f => f.payload.agent_id)
    expect(sub.map(f => f.event).sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SubagentStart', 'SubagentStop'].sort()
    )
    for (const f of sub) await record(f)
    const calls = (sessionRepository.upsertChildForHookEvent as jest.Mock).mock
      .calls
    expect(calls).toHaveLength(sub.length)
    for (const [arg] of calls) {
      expect(arg).toMatchObject({
        parentSessionId: ROOT,
        agentId: SUB,
        agent: 'CODEX',
      })
    }
    expect(sessionRepository.upsertForHookEvent).not.toHaveBeenCalled()
  })

  it('main-session events stay on the root session', async () => {
    const main = FIXTURES.filter(f => !f.payload.agent_id)
    for (const f of main) await record(f)
    expect(sessionRepository.upsertChildForHookEvent).not.toHaveBeenCalled()
    expect(sessionRepository.upsertForHookEvent).toHaveBeenCalledTimes(
      main.length
    )
  })

  it('apply_patch is indexed by the patched file', async () => {
    const patch = FIXTURES.find(
      f => f.event === 'PostToolUse' && f.payload.tool_name === 'apply_patch'
    )!
    await record(patch)
    expect(
      (hookEventRepository.createHookEvent as jest.Mock).mock.calls[0][0]
    ).toMatchObject({ toolName: 'apply_patch', filePath: '/repo/a.txt' })
  })

  it('a Codex STOP settles rollout-derived subagent usage on the child', async () => {
    const stop = FIXTURES.find(f => f.event === 'Stop')!
    const u = (input: number) => ({
      inputTokens: input,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      byModel: {
        'gpt-6.1-sol': { input, output: 1, cacheRead: 0, cacheCreation: 0 },
      },
    })
    await record({
      ...stop,
      payload: {
        ...stop.payload,
        _lumo_usage: { ...u(300), bySubagent: { [SUB]: u(100) } },
      },
    })
    expect(sessionRepository.settleChildUsage).toHaveBeenCalledWith(
      expect.objectContaining({ parentSessionId: ROOT, agentId: SUB })
    )
  })
})
