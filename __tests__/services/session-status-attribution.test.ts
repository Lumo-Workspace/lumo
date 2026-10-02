/**
 * @jest-environment node
 *
 * LUM-932 P4: getSessionStatus returns the run's attribution. A child session
 * shows its family, so the parent id is what the attribution lookup receives.
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findForMemberWithBinding: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn(async () => 'wm_1') },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {},
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {},
}))
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {},
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {},
}))
jest.mock('@/lib/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {},
}))
jest.mock('@/lib/services/session-list.service', () => ({
  sessionListService: { getAttribution: jest.fn() },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { sessionListService } from '@/lib/services/session-list.service'
import { sessionService } from '@/lib/services/session.service'

const repo = sessionRepository as jest.Mocked<typeof sessionRepository>
const list = sessionListService as jest.Mocked<typeof sessionListService>
const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}
const view = {
  segments: [],
  subagents: [],
  unattributed: true,
  approximate: false,
}
const base = {
  startedAt: new Date(),
  lastActivityAt: new Date(),
  eventCount: 3,
  role: 'IMPLEMENTATION' as const,
  milestone: null,
  task: null,
}

beforeEach(() => jest.clearAllMocks())

describe('getSessionStatus attribution', () => {
  it('returns attribution for a root session', async () => {
    repo.findForMemberWithBinding.mockResolvedValue({
      ...base,
      id: 'P',
      parentSessionId: null,
      agentType: null,
    } as never)
    list.getAttribution.mockResolvedValue(view)
    const r = await sessionService.getSessionStatus({
      identity,
      sessionId: 'P',
    })
    expect(list.getAttribution).toHaveBeenCalledWith('P')
    expect(r).toMatchObject({
      exists: true,
      parentSessionId: null,
      agentType: null,
      attribution: view,
    })
  })

  it('passes the parent id for a child session', async () => {
    repo.findForMemberWithBinding.mockResolvedValue({
      ...base,
      id: 'P:a1',
      parentSessionId: 'P',
      agentType: 'Explore',
    } as never)
    list.getAttribution.mockResolvedValue(view)
    const r = await sessionService.getSessionStatus({
      identity,
      sessionId: 'P:a1',
    })
    expect(list.getAttribution).toHaveBeenCalledWith('P')
    expect(r).toMatchObject({ parentSessionId: 'P', agentType: 'Explore' })
  })

  it('does not look up attribution when the session is not the caller own', async () => {
    repo.findForMemberWithBinding.mockResolvedValue(null)
    const r = await sessionService.getSessionStatus({
      identity,
      sessionId: 'X',
    })
    expect(r).toEqual({ exists: false })
    expect(list.getAttribution).not.toHaveBeenCalled()
  })
})
