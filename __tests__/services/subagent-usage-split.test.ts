/**
 * @jest-environment node
 *
 * LUM-932 acceptance #4: subagent usage is split out of the parent session and
 * never double counted.
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
    upsertChildForHookEvent: jest.fn(),
    settleChildUsage: jest.fn(async () => ({ settled: true })),
  },
}))
// LUM-932 P3: unattached events ask for a provisional task; nothing resolves here.
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

import {
  parseInjectedUsage,
  splitSubagentUsage,
  usageTotal,
} from '@/lib/session/subagent-usage'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const m = (input: number, output: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheCreation: 0,
})

const payload = {
  _lumo_usage: {
    inputTokens: 300,
    outputTokens: 30,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    byModel: { opus: m(200, 20), sonnet: m(100, 10) },
    bySubagent: {
      abeaba01ea909a7ee: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        byModel: { sonnet: m(100, 10) },
      },
    },
  },
}

beforeEach(() => jest.clearAllMocks())

describe('splits subagent usage out of the parent without double counting', () => {
  it('parses bySubagent and leaves it absent for old CLIs', () => {
    const u = parseInjectedUsage(payload)!
    expect(u.bySubagent?.abeaba01ea909a7ee?.inputTokens).toBe(100)
    const old = parseInjectedUsage({
      _lumo_usage: { ...payload._lumo_usage, bySubagent: undefined },
    })!
    expect(old.bySubagent).toBeUndefined()
  })

  it('main excludes every subagent and main + subagents equals the total', () => {
    const u = parseInjectedUsage(payload)!
    const { main, bySubagent } = splitSubagentUsage(u)
    expect(main.inputTokens).toBe(200)
    expect(main.byModel).toEqual({ opus: m(200, 20), sonnet: m(0, 0) })
    const sum =
      usageTotal(main) +
      Object.values(bySubagent).reduce((s, x) => s + usageTotal(x), 0)
    expect(sum).toBe(usageTotal(u))
  })

  it('is a no-op split when there is no bySubagent', () => {
    const u = parseInjectedUsage({
      _lumo_usage: { ...payload._lumo_usage, bySubagent: undefined },
    })!
    const { main, bySubagent } = splitSubagentUsage(u)
    expect(main).toEqual(u)
    expect(bySubagent).toEqual({})
  })

  it('drops subagent keys that are not valid agent ids', () => {
    const u = parseInjectedUsage({
      _lumo_usage: {
        ...payload._lumo_usage,
        bySubagent: {
          'bad id;': payload._lumo_usage.bySubagent.abeaba01ea909a7ee,
        },
      },
    })!
    expect(u.bySubagent).toEqual({})
  })

  const identity = {
    user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
    workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
    apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
  }

  it('a parent STOP writes main-only usage on the parent and settles each subagent', async () => {
    const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: { session_id: 'P', ...payload },
    })
    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'P',
        isStop: true,
        usage: expect.objectContaining({ inputTokens: 200 }),
      })
    )
    expect(sess.settleChildUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: 'P',
        agentId: 'abeaba01ea909a7ee',
        usage: expect.objectContaining({ inputTokens: 100 }),
      })
    )
  })

  it('ignores _lumo_usage on events emitted inside a subagent', async () => {
    const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
    sess.upsertChildForHookEvent.mockResolvedValue({
      id: 'P:abeaba01ea909a7ee',
      taskId: null,

      steward: false,
    })
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_BATCH',
      payload: { session_id: 'P', agent_id: 'abeaba01ea909a7ee', ...payload },
    })
    expect(sess.upsertChildForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: 'P',
        agentId: 'abeaba01ea909a7ee',
      })
    )
    expect(sess.upsertForHookEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ usage: expect.anything() })
    )
    expect(sess.settleChildUsage).not.toHaveBeenCalled()
  })

  it('treats an agent_id that cannot form a child id as absent (event stays on the parent)', async () => {
    const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
    const events = hookEventRepository as jest.Mocked<
      typeof hookEventRepository
    >
    const result = await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'P', agent_id: 'not a valid:id' },
    })
    expect(sess.upsertChildForHookEvent).not.toHaveBeenCalled()
    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'P' })
    )
    expect(events.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'P' })
    )
    expect(result.sessionId).toBe('P')
  })

  it('settles child usage best-effort after the STOP event is recorded', async () => {
    const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
    const events = hookEventRepository as jest.Mocked<
      typeof hookEventRepository
    >
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    sess.settleChildUsage.mockRejectedValueOnce(new Error('db down'))
    const twoSubagents = {
      _lumo_usage: {
        ...payload._lumo_usage,
        bySubagent: {
          ...payload._lumo_usage.bySubagent,
          b2: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            byModel: { sonnet: m(1, 1) },
          },
        },
      },
    }
    await expect(
      hookEventService.recordHookEvent({
        identity,
        type: 'STOP',
        payload: { session_id: 'P', ...twoSubagents },
      })
    ).resolves.toEqual(expect.objectContaining({ sessionId: 'P' }))
    expect(events.createHookEvent).toHaveBeenCalledTimes(1)
    // One failure does not abort the remaining settlements.
    expect(sess.settleChildUsage).toHaveBeenCalledTimes(2)
    // Settlement runs after the STOP row is written.
    expect(events.createHookEvent.mock.invocationCallOrder[0]!).toBeLessThan(
      sess.settleChildUsage.mock.invocationCallOrder[0]!
    )
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
