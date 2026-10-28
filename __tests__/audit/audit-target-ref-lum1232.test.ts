/**
 * @jest-environment node
 *
 * LUM-1232 batch G (G1) — the audit log shows a boundary crossing target by
 * its `<TEAM>-X<n>` ref instead of the cuid, looked up in the viewer's
 * workspace only.
 */
const mockRepo = {
  listPage: jest.fn(),
  findWorkspaceMembers: jest.fn(),
  create: jest.fn(),
  findMemberClerkId: jest.fn(),
}
const mockCrossings = { findRefFieldsByIds: jest.fn() }

jest.mock('@/lib/repositories/audit-event.repository', () => ({
  get auditEventRepository() {
    return mockRepo
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  get boundaryCrossingRepository() {
    return mockCrossings
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: jest.fn().mockResolvedValue('OWNER') },
}))
jest.mock('@/lib/auth/user-profiles', () => ({
  lookupUserProfiles: jest.fn().mockResolvedValue(new Map()),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { listAuditEvents } from '@/lib/services/audit-query.service'

const NOW = new Date('2026-10-18T00:00:00.000Z')
const viewer = { workspaceId: 'ws_1', memberId: 'm_owner', clerkId: 'u_owner' }

function row(id: string, targetType: string, targetId: string | null) {
  return {
    id,
    createdAt: new Date('2026-10-17T07:07:37.000Z'),
    action: `${targetType}.something`,
    actorType: 'MEMBER',
    actorId: 'u_owner',
    actorMemberId: 'm_owner',
    source: 'CLI',
    targetType,
    targetId,
    ip: null,
    userAgent: null,
    metadata: null,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('audit list target refs (LUM-1232 G1)', () => {
  it('a boundary crossing target carries its LUM-X ref; other targets keep null', async () => {
    mockRepo.listPage.mockResolvedValue([
      row('ev_1', 'boundary_crossing', 'cmvc1w4f7000u08larvqrob83'),
      row('ev_2', 'member', 'm_2'),
    ])
    mockCrossings.findRefFieldsByIds.mockResolvedValue([
      {
        id: 'cmvc1w4f7000u08larvqrob83',
        number: 928,
        task: { team: { identifier: 'LUM' } },
      },
    ])
    const page = await listAuditEvents(viewer, {}, NOW)
    expect(mockCrossings.findRefFieldsByIds).toHaveBeenCalledWith('ws_1', [
      'cmvc1w4f7000u08larvqrob83',
    ])
    expect(page.events.map(e => e.targetRef)).toEqual(['LUM-X928', null])
    expect(page.events[0]!.targetId).toBe('cmvc1w4f7000u08larvqrob83')
  })

  it('a crossing outside the viewer workspace (not returned) gets no ref', async () => {
    mockRepo.listPage.mockResolvedValue([
      row('ev_1', 'boundary_crossing', 'c_other_ws'),
    ])
    mockCrossings.findRefFieldsByIds.mockResolvedValue([])
    const page = await listAuditEvents(viewer, {}, NOW)
    expect(page.events[0]!.targetRef).toBeNull()
  })

  it('a failed lookup degrades to the id, never an error', async () => {
    mockRepo.listPage.mockResolvedValue([
      row('ev_1', 'boundary_crossing', 'c_1'),
    ])
    mockCrossings.findRefFieldsByIds.mockRejectedValue(new Error('db down'))
    const page = await listAuditEvents(viewer, {}, NOW)
    expect(page.events[0]!.targetRef).toBeNull()
  })

  it('pages without crossing targets do not query crossings', async () => {
    mockRepo.listPage.mockResolvedValue([row('ev_1', 'member', 'm_2')])
    await listAuditEvents(viewer, {}, NOW)
    expect(mockCrossings.findRefFieldsByIds).not.toHaveBeenCalled()
  })
})
