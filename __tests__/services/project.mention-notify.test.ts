import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// next/jest uses SWC, whose jest transform only allows factory closures to
// reference variables prefixed with `mock` (it hoists jest.mock above these
// declarations). Hence the `mock`-prefixed names below.
const mockFindById = jest.fn()
const mockUpdate = jest.fn()
const mockFindByActorId = jest.fn()
const mockFindActorByMemberId = jest.fn()
const mockMemberFindById = jest.fn()
const mockGetActorClerkId = jest.fn()
const mockFindNameAndSlug = jest.fn()
const mockPushWorkspaceEvent = jest.fn()
const mockNotifyMentionDelta = jest.fn()

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
  mockFindById.mockResolvedValue({
    id: 'p1',
    workspaceId: 'ws1',
    description: '',
    isIdea: false,
    createdByMemberId: 'mem1',
  })
  mockMemberFindById.mockResolvedValue({ id: 'mem1', workspaceId: 'ws1' })
  mockUpdate.mockResolvedValue({ id: 'p1', name: 'Proj', isIdea: false, owner: null })
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

    expect(mockNotifyMentionDelta).toHaveBeenCalledTimes(1)
    const arg = mockNotifyMentionDelta.mock.calls[0]![0] as Record<string, unknown>
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
    expect(mockNotifyMentionDelta).not.toHaveBeenCalled()
  })
})
