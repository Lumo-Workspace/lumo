/**
 * @jest-environment node
 *
 * LUM-678 (Spec2-16): Initiative two-layer composition. Drives the real service
 * through a mocked repository + team resolver, asserting the resolution rule:
 * the contents list the initiative's milestones (each with their tasks) PLUS
 * its directly-attached tasks, and a task sitting under a milestone is NOT also
 * double-counted as a direct task.
 */
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/repositories/initiative.repository', () => ({
  initiativeRepository: {
    findCompositionById: jest.fn(),
    // referenced elsewhere in the module surface; unused here.
    listByTeam: jest.fn(),
    findDetailById: jest.fn(),
    create: jest.fn(),
  },
}))

import { initiativeService } from '@/lib/services/initiative.service'
import { getDefaultTeam } from '@/lib/team'
import { initiativeRepository } from '@/lib/repositories/initiative.repository'

const TEAM = { id: 'team-1', identifier: 'LUM' }

beforeEach(() => jest.clearAllMocks())

describe('initiativeService.getComposition', () => {
  it('initiative composition lists milestones and direct tasks without double counting', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    // T1 sits under milestone m1 (and is also initiative-linked); T2 is attached
    // directly to the initiative (no milestone).
    ;(initiativeRepository.findCompositionById as jest.Mock).mockResolvedValue({
      id: 'init-1',
      number: 3,
      teamId: 'team-1',
      name: 'Ship the browse surface',
      milestones: [
        {
          id: 'm1',
          name: 'Milestone One',
          slug: 'milestone-one',
          status: 'PLANNED',
          tasks: [{ id: 't1', number: 1, title: 'T1', status: 'TODO' }],
        },
      ],
      tasks: [
        { id: 't1', number: 1, title: 'T1', status: 'TODO', milestoneId: 'm1' },
        { id: 't2', number: 2, title: 'T2', status: 'TODO', milestoneId: null },
      ],
    })

    const composition = await initiativeService.getComposition({
      workspaceId: 'w1',
      initiativeId: 'init-1',
    })

    expect(getDefaultTeam).toHaveBeenCalledWith('w1')
    expect(initiativeRepository.findCompositionById).toHaveBeenCalledWith(
      'init-1'
    )
    expect(composition.identifier).toBe('LUM-INIT-3')

    // The milestone layer lists its own task (T1).
    expect(composition.milestones).toHaveLength(1)
    expect(composition.milestones[0]!.tasks.map(t => t.id)).toEqual(['t1'])

    // The direct layer is ONLY T2 — T1 is under a milestone and must not be
    // double-counted as a direct task.
    expect(composition.directTasks.map(t => t.id)).toEqual(['t2'])
    expect(composition.directTasks.map(t => t.id)).not.toContain('t1')
    expect(composition.directTasks[0]!.identifier).toBe('LUM-2')
  })

  it('fails closed with 404 on a cross-team initiative id', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(initiativeRepository.findCompositionById as jest.Mock).mockResolvedValue({
      id: 'init-9',
      number: 9,
      teamId: 'other-team',
      name: 'Someone else',
      milestones: [],
      tasks: [],
    })

    await expect(
      initiativeService.getComposition({
        workspaceId: 'w1',
        initiativeId: 'init-9',
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})
