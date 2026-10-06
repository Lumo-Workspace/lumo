import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// next/jest uses SWC, whose jest transform only allows factory closures to
// reference variables prefixed with `mock` (it hoists jest.mock above these
// declarations). Hence the `mock`-prefixed names below.
const mockFindById = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockUpdate = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindByActorId = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindActorByMemberId = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockMemberFindById = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockGetActorClerkId = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindNameAndSlug = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockPushWorkspaceEvent = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockNotifyMentionDelta = jest.fn<(...args: any[]) => Promise<unknown>>()

// Collect fire-and-forget promises so the test can await them before asserting
// (the notify resolution runs inside an async waitUntil callback).
const mockBackgroundPromises: Promise<unknown>[] = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    mockBackgroundPromises.push(Promise.resolve(p))
  },
}))

async function flushBackground() {
  await Promise.all(mockBackgroundPromises)
}

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findById: (...a: unknown[]) => mockFindById(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findById: (...a: unknown[]) => mockMemberFindById(...a),
    findByActorId: (...a: unknown[]) => mockFindByActorId(...a),
    findActorByMemberId: (...a: unknown[]) => mockFindActorByMemberId(...a),
  },
}))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: (...a: unknown[]) => mockGetActorClerkId(...a),
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findNameAndSlug: (...a: unknown[]) => mockFindNameAndSlug(...a),
  },
}))
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushWorkspaceEvent: (...a: unknown[]) => mockPushWorkspaceEvent(...a),
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: (...a: unknown[]) => mockNotifyMentionDelta(...a),
}))

// Import lazily (after jest.mock registration) so the service's imports
// resolve to the mocked modules, not the real ones.
async function getService() {
  const mod = await import('@/lib/services/project.service')
  return mod.projectService
}

const span = (clerkId: string) =>
  `<span class="mention" data-mention-type="user" data-id="${clerkId}">@u</span>`

beforeEach(() => {
  jest.clearAllMocks()
  mockBackgroundPromises.length = 0
  mockFindById.mockResolvedValue({
    id: 'p1',
    workspaceId: 'ws1',
    description: '',
    isIdea: false,
    createdByMemberId: 'mem1',
  })
  mockMemberFindById.mockResolvedValue({ id: 'mem1', workspaceId: 'ws1' })
  mockUpdate.mockResolvedValue({
    id: 'p1',
    name: 'Proj',
    isIdea: false,
    owner: null,
  })
  mockFindActorByMemberId.mockResolvedValue({ id: 'a1' })
  mockGetActorClerkId.mockResolvedValue('author')
  mockFindNameAndSlug.mockResolvedValue({ name: 'WS', slug: 'ws' })
  mockPushWorkspaceEvent.mockResolvedValue(undefined)
  mockNotifyMentionDelta.mockResolvedValue(undefined)
})

describe('updateProject @mention notifications', () => {
  it('fires notifyMentionDelta with PROJECT_MENTIONED when description changes', async () => {
    const projectService = await getService()
    await projectService.updateProject('p1', 'ws', 'mem1', {
      description: span('u1'),
    })
    await flushBackground()

    expect(mockNotifyMentionDelta).toHaveBeenCalledTimes(1)
    const arg = mockNotifyMentionDelta.mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(arg).toMatchObject({
      notificationType: 'PROJECT_MENTIONED',
      ref: { projectId: 'p1' },
      oldHtml: '',
      newHtml: span('u1'),
      workspaceId: 'ws1',
      authorActorId: 'a1',
      authorClerkId: 'author',
    })
  })

  it('does not fire when description is not part of the update', async () => {
    const projectService = await getService()
    await projectService.updateProject('p1', 'ws', 'mem1', { name: 'Renamed' })
    await flushBackground()
    expect(mockNotifyMentionDelta).not.toHaveBeenCalled()
  })
})
