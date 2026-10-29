/**
 * LUM-1334: reading and changing the DONE requirement switches — any member
 * reads, the write goes through updateWorkspace (OWNER gate + audit).
 */
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findDoneRequirements: jest.fn() },
}))
jest.mock('@/lib/services/workspace.service', () => ({
  workspaceService: { updateWorkspace: jest.fn(async () => ({})) },
}))

import { doneRequirementsSettingsService } from '@/lib/services/done-requirements-settings.service'
import { updateDoneRequirementsSchema } from '@/lib/validation/done-requirements'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { workspaceService } from '@/lib/services/workspace.service'

const role = miscRepository.findMemberRoleById as jest.Mock
const read = workspaceRepository.findDoneRequirements as jest.Mock
const update = workspaceService.updateWorkspace as jest.Mock
const caller = { memberId: 'm-1', workspaceId: 'w-1', workspaceSlug: 'lumo' }

beforeEach(() => jest.clearAllMocks())

describe('doneRequirementsSettingsService', () => {
  it('reads the switches and whether the caller may change them', async () => {
    role.mockResolvedValue('MEMBER')
    read.mockResolvedValue({ testCase: true, review: false })
    expect(await doneRequirementsSettingsService.get(caller)).toEqual({
      testCase: true,
      review: false,
      canEdit: false,
    })
  })

  it('404s for a missing workspace', async () => {
    role.mockResolvedValue('OWNER')
    read.mockResolvedValue(null)
    await expect(
      doneRequirementsSettingsService.get(caller)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('writes only the switches sent, through updateWorkspace with the role', async () => {
    role.mockResolvedValue('OWNER')
    read.mockResolvedValue({ testCase: false, review: true })
    const audit = { actor: 'x' } as never
    await doneRequirementsSettingsService.update(
      caller,
      { review: true },
      audit
    )
    expect(update).toHaveBeenCalledWith(
      'w-1',
      'OWNER',
      'lumo',
      { doneRequiresReview: true },
      audit
    )
  })
})

describe('updateDoneRequirementsSchema', () => {
  it('needs at least one boolean switch and nothing else', () => {
    expect(
      updateDoneRequirementsSchema.safeParse({ testCase: true }).success
    ).toBe(true)
    expect(updateDoneRequirementsSchema.safeParse({}).success).toBe(false)
    expect(
      updateDoneRequirementsSchema.safeParse({ testCase: 'on' }).success
    ).toBe(false)
    expect(
      updateDoneRequirementsSchema.safeParse({ review: true, other: 1 }).success
    ).toBe(false)
  })
})
