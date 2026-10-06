import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// next/jest uses SWC: factory closures may only reference `mock`-prefixed vars.
const mockMilestoneFindById = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockMilestoneUpdate = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockGetProject = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindActorByMemberId = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockGetActorClerkId = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindNameAndSlug = jest.fn<(...args: any[]) => Promise<unknown>>()
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

jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: unknown[]) => mockMilestoneFindById(...a),
    update: (...a: unknown[]) => mockMilestoneUpdate(...a),
  },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: {
    getProject: (...a: unknown[]) => mockGetProject(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
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
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: (...a: unknown[]) => mockNotifyMentionDelta(...a),
}))

async function getService() {
  const mod = await import('@/lib/services/milestone.service')
  return mod.milestoneService
}

const span = (clerkId: string) =>
  `<span class="mention" data-mention-type="user" data-id="${clerkId}">@u</span>`

beforeEach(() => {
  jest.clearAllMocks()
  mockBackgroundPromises.length = 0
  mockMilestoneFindById.mockResolvedValue({
    id: 'm1',
    projectId: 'proj1',
    description: '',
    status: 'PLANNED',
    archivedAt: null,
  })
  mockGetProject.mockResolvedValue({
    id: 'proj1',
    workspaceId: 'ws1',
    name: 'Proj',
    teamId: 'team1',
  })
  mockMilestoneUpdate.mockResolvedValue({
    id: 'm1',
    slug: 'milestone-slug',
    status: 'PLANNED',
  })
  mockFindActorByMemberId.mockResolvedValue({ id: 'a1' })
  mockGetActorClerkId.mockResolvedValue('author')
  mockFindNameAndSlug.mockResolvedValue({ name: 'WS', slug: 'ws' })
  mockNotifyMentionDelta.mockResolvedValue(undefined)
})

describe('updateMilestone @mention notifications', () => {
  it('fires notifyMentionDelta with MILESTONE_MENTIONED when description changes', async () => {
    const milestoneService = await getService()
    await milestoneService.updateMilestone('m1', 'mem1', {
      description: span('u1'),
    })
    await flushBackground()

    expect(mockNotifyMentionDelta).toHaveBeenCalledTimes(1)
    const arg = mockNotifyMentionDelta.mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(arg).toMatchObject({
      notificationType: 'MILESTONE_MENTIONED',
      ref: { milestoneId: 'm1' },
      oldHtml: '',
      newHtml: span('u1'),
      workspaceId: 'ws1',
      authorActorId: 'a1',
      authorClerkId: 'author',
    })
  })

  it('does not fire when description is not part of the update', async () => {
    const milestoneService = await getService()
    await milestoneService.updateMilestone('m1', 'mem1', { name: 'Renamed' })
    await flushBackground()
    expect(mockNotifyMentionDelta).not.toHaveBeenCalled()
  })
})
