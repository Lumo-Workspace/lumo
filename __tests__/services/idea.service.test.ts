jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: {
    createCaptured: jest.fn(),
    listCapturedByTeam: jest.fn(),
    listPoolByTeam: jest.fn(),
    findByNumber: jest.fn(),
    findByIdInTeam: jest.fn(),
    updateStatusInTeam: jest.fn(),
  },
}))
// LUM-680: idea mutations now record activity — mock the repo so these unit
// tests don't reach prisma.
jest.mock('@/lib/repositories/idea-activity.repository', () => ({
  ideaActivityRepository: { create: jest.fn(), listByIdea: jest.fn() },
}))

import { ideaService } from '@/lib/services/idea.service'
import { getDefaultTeam } from '@/lib/team'
import { ideaRepository } from '@/lib/repositories/idea.repository'

const TEAM = { id: 'team-1', identifier: 'LUM' }

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'i1',
  number: 8,
  statement: 'ship it',
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  teamId: 'team-1',
  workspaceId: 'w1',
  createdAt: new Date(0),
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('ideaService.capture', () => {
  it('resolves the default team, stores the idea, and returns an I-prefixed id', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.createCaptured as jest.Mock).mockResolvedValue(row())

    const idea = await ideaService.capture({
      workspaceId: 'w1',
      memberId: 'm1',
      input: {
        statement: 'ship it',
        sourceSessionId: 'sess-1',
        sourceTaskId: 'LUM-9',
      },
    })

    expect(getDefaultTeam).toHaveBeenCalledWith('w1')
    expect(idea.identifier).toBe('LUM-I8')
    expect(ideaRepository.createCaptured).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        workspaceId: 'w1',
        statement: 'ship it',
        sourceSessionId: 'sess-1',
        sourceTaskId: 'LUM-9',
        proposedByMemberId: 'm1',
      })
    )
  })

  it('trims and null-collapses blank provenance fields', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.createCaptured as jest.Mock).mockResolvedValue(row())

    await ideaService.capture({
      workspaceId: 'w1',
      memberId: 'm1',
      input: { statement: 'x', sourceContext: '  ', sourceSessionId: '  ' },
    })

    expect(ideaRepository.createCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ sourceContext: null, sourceSessionId: null })
    )
  })

  it('rejects a blank statement with status 400 without touching the repo', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    await expect(
      ideaService.capture({
        workspaceId: 'w1',
        memberId: 'm1',
        input: { statement: '   ' },
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(ideaRepository.createCaptured).not.toHaveBeenCalled()
  })

  it('throws 404 when the workspace has no default team', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(null)
    await expect(
      ideaService.capture({
        workspaceId: 'w1',
        memberId: 'm1',
        input: { statement: 'x' },
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('ideaService.listPool', () => {
  it("scopes to the caller's default team and maps I-prefixed ids", async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.listPoolByTeam as jest.Mock).mockResolvedValue([
      row({ id: 'i2', number: 2 }),
      row({ id: 'i1', number: 1 }),
    ])

    const ideas = await ideaService.listPool({ workspaceId: 'w1' })

    // Never crosses teams — the repo is queried with the resolved team id.
    expect(ideaRepository.listPoolByTeam).toHaveBeenCalledWith('team-1')
    // Order is whatever the repo returns (newest-first); the service preserves it.
    expect(ideas.map(i => i.identifier)).toEqual(['LUM-I2', 'LUM-I1'])
  })

  it('projects the materialisation lineage for a PLANNED idea and null for CAPTURED', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.listPoolByTeam as jest.Mock).mockResolvedValue([
      row({
        id: 'i2',
        number: 2,
        status: 'PLANNED',
        planRunId: 'run-1',
        initiative: { id: 'init-1', number: 3, name: 'ship pool' },
      }),
      row({ id: 'i1', number: 1, planRunId: null, initiative: null }),
    ])

    const ideas = await ideaService.listPool({ workspaceId: 'w1' })

    expect(ideas[0]).toMatchObject({
      status: 'PLANNED',
      planRunId: 'run-1',
      initiative: { id: 'init-1', number: 3, name: 'ship pool' },
    })
    expect(ideas[1]).toMatchObject({
      status: 'CAPTURED',
      planRunId: null,
      initiative: null,
    })
  })

  it('returns an empty pool when the workspace has no default team', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(null)
    const ideas = await ideaService.listPool({ workspaceId: 'w1' })
    expect(ideas).toEqual([])
    expect(ideaRepository.listPoolByTeam).not.toHaveBeenCalled()
  })
})

describe('ideaService.updateStatus', () => {
  it('resolves LUM-I<n>, allows a legal transition, and returns the updated pool idea', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(
      row({ id: 'i1', number: 8, status: 'CAPTURED' })
    )
    ;(ideaRepository.updateStatusInTeam as jest.Mock).mockResolvedValue(
      row({ id: 'i1', number: 8, status: 'DEVELOPING' })
    )

    const idea = await ideaService.updateStatus({
      workspaceId: 'w1',
      ideaRef: 'LUM-I8',
      status: 'DEVELOPING',
    })

    expect(ideaRepository.findByNumber).toHaveBeenCalledWith('team-1', 8)
    expect(ideaRepository.updateStatusInTeam).toHaveBeenCalledWith({
      ideaId: 'i1',
      teamId: 'team-1',
      status: 'DEVELOPING',
    })
    expect(idea).toMatchObject({ identifier: 'LUM-I8', status: 'DEVELOPING' })
  })

  it('accepts a bare number as the idea ref', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(
      row({ number: 3, status: 'DEVELOPING' })
    )
    ;(ideaRepository.updateStatusInTeam as jest.Mock).mockResolvedValue(
      row({ number: 3, status: 'PLANNED' })
    )

    await ideaService.updateStatus({
      workspaceId: 'w1',
      ideaRef: '3',
      status: 'PLANNED',
    })

    expect(ideaRepository.findByNumber).toHaveBeenCalledWith('team-1', 3)
    expect(ideaRepository.findByIdInTeam).not.toHaveBeenCalled()
  })

  it('resolves a cuid ref via findByIdInTeam (the web addresses by id)', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByIdInTeam as jest.Mock).mockResolvedValue(
      row({ id: 'clabc123', number: 5, status: 'CAPTURED' })
    )
    ;(ideaRepository.updateStatusInTeam as jest.Mock).mockResolvedValue(
      row({ id: 'clabc123', number: 5, status: 'DEVELOPING' })
    )

    await ideaService.updateStatus({
      workspaceId: 'w1',
      ideaRef: 'clabc123',
      status: 'DEVELOPING',
    })

    expect(ideaRepository.findByIdInTeam).toHaveBeenCalledWith(
      'clabc123',
      'team-1'
    )
    expect(ideaRepository.findByNumber).not.toHaveBeenCalled()
    expect(ideaRepository.updateStatusInTeam).toHaveBeenCalledWith({
      ideaId: 'clabc123',
      teamId: 'team-1',
      status: 'DEVELOPING',
    })
  })

  it('rejects a disallowed transition with 400 without writing', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(
      row({ number: 8, status: 'CAPTURED' })
    )

    await expect(
      ideaService.updateStatus({
        workspaceId: 'w1',
        ideaRef: 'LUM-I8',
        status: 'PLANNED', // CAPTURED→PLANNED is not a manual move
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(ideaRepository.updateStatusInTeam).not.toHaveBeenCalled()
  })

  it('rejects a transition out of the terminal DROPPED state with 400', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(
      row({ number: 8, status: 'DROPPED' })
    )

    await expect(
      ideaService.updateStatus({
        workspaceId: 'w1',
        ideaRef: 'LUM-I8',
        status: 'CAPTURED',
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(ideaRepository.updateStatusInTeam).not.toHaveBeenCalled()
  })

  it('throws 404 when no idea matches the ref', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(null)

    await expect(
      ideaService.updateStatus({
        workspaceId: 'w1',
        ideaRef: 'LUM-I99',
        status: 'DROPPED',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(ideaRepository.updateStatusInTeam).not.toHaveBeenCalled()
  })

  it('throws 404 when the workspace has no default team', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(null)

    await expect(
      ideaService.updateStatus({
        workspaceId: 'w1',
        ideaRef: 'LUM-I8',
        status: 'DROPPED',
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})
