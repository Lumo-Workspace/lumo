/** @jest-environment node */
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: {
    findByNumber: jest.fn(),
    findByIdInTeam: jest.fn(),
  },
}))

import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { getDefaultTeam } from '@/lib/team'
import { ideaRepository } from '@/lib/repositories/idea.repository'

const TEAM = { id: 'team-1', identifier: 'LUM' }

const idea = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'idea-cuid-1',
  number: 3,
  teamId: 'team-1',
  workspaceId: 'w1',
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('resolveIdeaRef', () => {
  it('resolves a cuid ref via findByIdInTeam', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByIdInTeam as jest.Mock).mockResolvedValue(idea())

    const result = await resolveIdeaRef({
      workspaceId: 'w1',
      ideaRef: 'idea-cuid-1',
    })

    expect(getDefaultTeam).toHaveBeenCalledWith('w1')
    expect(ideaRepository.findByIdInTeam).toHaveBeenCalledWith(
      'idea-cuid-1',
      'team-1'
    )
    expect(ideaRepository.findByNumber).not.toHaveBeenCalled()
    expect(result).toEqual({
      ideaId: 'idea-cuid-1',
      workspaceId: 'w1',
      teamId: 'team-1',
    })
  })

  it('resolves a <TEAM>-I<n> identifier ref via findByNumber', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(idea())

    const result = await resolveIdeaRef({
      workspaceId: 'w1',
      ideaRef: 'LUM-I3',
    })

    expect(ideaRepository.findByNumber).toHaveBeenCalledWith('team-1', 3)
    expect(ideaRepository.findByIdInTeam).not.toHaveBeenCalled()
    expect(result).toEqual({
      ideaId: 'idea-cuid-1',
      workspaceId: 'w1',
      teamId: 'team-1',
    })
  })

  it('resolves a bare-number ref via findByNumber', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(idea())

    const result = await resolveIdeaRef({ workspaceId: 'w1', ideaRef: '3' })

    expect(ideaRepository.findByNumber).toHaveBeenCalledWith('team-1', 3)
    expect(ideaRepository.findByIdInTeam).not.toHaveBeenCalled()
    expect(result).toEqual({
      ideaId: 'idea-cuid-1',
      workspaceId: 'w1',
      teamId: 'team-1',
    })
  })

  it('throws 404 when the workspace has no default team', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(null)

    await expect(
      resolveIdeaRef({ workspaceId: 'w1', ideaRef: 'LUM-I3' })
    ).rejects.toMatchObject({ message: 'Idea not found', status: 404 })
    expect(ideaRepository.findByNumber).not.toHaveBeenCalled()
    expect(ideaRepository.findByIdInTeam).not.toHaveBeenCalled()
  })

  it('throws 404 when the idea is not found in the caller team', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByIdInTeam as jest.Mock).mockResolvedValue(null)

    await expect(
      resolveIdeaRef({ workspaceId: 'w1', ideaRef: 'idea-cuid-1' })
    ).rejects.toMatchObject({ message: 'Idea not found', status: 404 })
  })
})
