/**
 * @jest-environment node
 *
 * LUM-1136 — every top-level hook event writes the CLI version it carried
 * (via the session upsert), so a session that outlives a `lumo update` reports
 * the CLI it runs now; the skill version is written at SessionStart only.
 * Child sessions never carry versions.
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { createHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertForHookEvent: jest.fn(),
    upsertChildForHookEvent: jest.fn(),
    recordClientVersions: jest.fn(),
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
  miscRepository: { findMemberIdForHook: jest.fn() },
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { hookEventService } from '@/lib/services/hook-event.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}
const versions = { cliVersion: '1.121.0', skillVersion: '1.120.0' }

beforeEach(() => {
  jest.clearAllMocks()
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  repo.createHookEvent.mockResolvedValue({ id: 'he_1' } as never)
  sess.upsertForHookEvent.mockResolvedValue({
    taskId: 'task_1',
    turnUsageByModel: null,
  } as never)
  sess.upsertChildForHookEvent.mockResolvedValue({
    id: 'sess_1:a1',
    taskId: 'task_1',
    steward: false,
  } as never)
})

describe('recordHookEvent — client versions', () => {
  it('SESSION_START records the skill version on the session', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'SESSION_START',
      payload: { session_id: 'sess_1' },
      clientVersions: versions,
    })
    expect(sess.recordClientVersions).toHaveBeenCalledWith('sess_1', {
      skillVersion: versions.skillVersion,
    })
  })

  it('every event passes the CLI version to the session upsert', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_1', tool_name: 'Read' },
      clientVersions: { cliVersion: '1.122.0' },
    })
    expect(sess.upsertForHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess_1', cliVersion: '1.122.0' })
    )
  })

  it('other event types do not write the skill version', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_1', tool_name: 'Read' },
      clientVersions: versions,
    })
    expect(sess.recordClientVersions).not.toHaveBeenCalled()
  })

  it('no CLI header → the upsert carries no cliVersion (never clears it)', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { session_id: 'sess_1', tool_name: 'Read' },
    })
    expect(sess.upsertForHookEvent.mock.calls[0]?.[0]).not.toHaveProperty(
      'cliVersion'
    )
  })

  it('a subagent SessionStart does not touch versions', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'SESSION_START',
      payload: { session_id: 'sess_1', agent_id: 'a1' },
      clientVersions: versions,
    })
    expect(sess.recordClientVersions).not.toHaveBeenCalled()
  })
})
