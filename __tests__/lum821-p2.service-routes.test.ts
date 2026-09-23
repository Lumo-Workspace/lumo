/**
 * @jest-environment node
 *
 * LUM-821 P2 (server): initiative update + progress updates (team-scoped,
 * LUM-INIT-<n> refs), CLI task delete, and the timeline / project routes
 * opened to CLI bearer auth.
 */
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/repositories/initiative.repository', () => ({
  initiativeRepository: {
    findRefByTeamNumber: jest.fn(),
    findRefById: jest.fn(),
    update: jest.fn(),
    createProgressUpdate: jest.fn(),
    listProgressUpdates: jest.fn(),
    listByTeam: jest.fn(),
    findDetailById: jest.fn(),
    findCompositionById: jest.fn(),
    create: jest.fn(),
  },
}))

import { initiativeService } from '@/lib/services/initiative.service'
import { getDefaultTeam } from '@/lib/team'
import { initiativeRepository } from '@/lib/repositories/initiative.repository'
import {
  createInitiativeUpdateSchema,
  updateInitiativeSchema,
} from '@/lib/validation/initiative'

const repo = initiativeRepository as unknown as Record<string, jest.Mock>
const TEAM = { id: 'team-1', identifier: 'LUM' }

beforeEach(() => {
  jest.clearAllMocks()
  ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
  repo.findRefByTeamNumber!.mockImplementation(async (_t: string, n: number) =>
    n === 3 ? { id: 'init-3', teamId: 'team-1' } : null
  )
  repo.findRefById!.mockImplementation(async (id: string) =>
    id === 'init-foreign' ? { id, teamId: 'team-OTHER' } : null
  )
  repo.update!.mockResolvedValue({
    id: 'init-3',
    number: 3,
    name: 'Goal',
    status: 'COMPLETED',
    createdAt: new Date(0),
    _count: { tasks: 2, ideas: 1 },
  })
})

describe('initiativeService.update', () => {
  it('resolves LUM-INIT-3 / bare 3 within the team and patches the fields', async () => {
    for (const ref of ['LUM-INIT-3', 'lum-init-3', '3']) {
      const out = await initiativeService.update({
        workspaceId: 'ws',
        ref,
        input: { status: 'COMPLETED', targetDate: '2026-09-29T16:00:00.000Z' },
      })
      expect(out.identifier).toBe('LUM-INIT-3')
    }
    expect(repo.update).toHaveBeenLastCalledWith('init-3', {
      status: 'COMPLETED',
      targetDate: '2026-09-29T16:00:00.000Z',
    })
  })

  it('a ref with another team’s prefix is 404 — never "number 1 in my team" (isolation run finding)', async () => {
    for (const ref of ['VIC-INIT-3', 'XYZ-INIT-3']) {
      await expect(
        initiativeService.update({
          workspaceId: 'ws',
          ref,
          input: { status: 'CANCELLED' },
        })
      ).rejects.toMatchObject({ status: 404 })
    }
    await expect(
      initiativeService.postProgressUpdate({
        workspaceId: 'ws',
        ref: 'VIC-INIT-3',
        authorMemberId: 'm1',
        input: { body: 'x' },
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(repo.update).not.toHaveBeenCalled()
    expect(repo.createProgressUpdate).not.toHaveBeenCalled()
    expect(repo.findRefByTeamNumber).not.toHaveBeenCalled()
  })

  it('another team’s initiative (by id) is the same 404 as a missing one', async () => {
    await expect(
      initiativeService.update({
        workspaceId: 'ws',
        ref: 'init-foreign',
        input: { name: 'x' },
      })
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      initiativeService.update({
        workspaceId: 'ws',
        ref: 'LUM-INIT-99',
        input: { name: 'x' },
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(repo.update).not.toHaveBeenCalled()
  })
})

describe('initiative progress updates', () => {
  it('posts with the caller as author and health (null when omitted)', async () => {
    repo.createProgressUpdate!.mockImplementation(async (d: object) => ({
      id: 'u1',
      ...d,
    }))
    await initiativeService.postProgressUpdate({
      workspaceId: 'ws',
      ref: 'LUM-INIT-3',
      authorMemberId: 'm1',
      input: { body: 'Shipped search', health: 'AT_RISK' },
    })
    await initiativeService.postProgressUpdate({
      workspaceId: 'ws',
      ref: '3',
      authorMemberId: 'm1',
      input: { body: 'No health' },
    })
    expect(repo.createProgressUpdate!.mock.calls.map(c => c[0])).toEqual([
      {
        initiativeId: 'init-3',
        authorMemberId: 'm1',
        body: 'Shipped search',
        health: 'AT_RISK',
      },
      {
        initiativeId: 'init-3',
        authorMemberId: 'm1',
        body: 'No health',
        health: null,
      },
    ])
  })

  it('lists newest-first through the repository (capped)', async () => {
    repo.listProgressUpdates!.mockResolvedValue([])
    await initiativeService.listProgressUpdates({
      workspaceId: 'ws',
      ref: 'LUM-INIT-3',
    })
    expect(repo.listProgressUpdates).toHaveBeenCalledWith('init-3', 50)
  })
})

describe('initiative schemas', () => {
  it('update: real InitiativeStatus enum only, at least one field', () => {
    expect(
      updateInitiativeSchema.safeParse({ status: 'COMPLETED' }).success
    ).toBe(true)
    expect(updateInitiativeSchema.safeParse({ status: 'DONE' }).success).toBe(
      false
    )
    expect(
      updateInitiativeSchema.safeParse({ status: 'DROPPED' }).success
    ).toBe(false)
    expect(updateInitiativeSchema.safeParse({}).success).toBe(false)
  })
  it('progress: non-empty body, known health', () => {
    expect(createInitiativeUpdateSchema.safeParse({ body: ' ' }).success).toBe(
      false
    )
    expect(
      createInitiativeUpdateSchema.safeParse({ body: 'x', health: 'MEH' })
        .success
    ).toBe(false)
  })
})
