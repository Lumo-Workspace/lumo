const mockUpdateStatementInTeam = jest.fn()
const mockGetDefaultTeam = jest.fn()

jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: {
    updateStatementInTeam: (...a: unknown[]) => mockUpdateStatementInTeam(...a),
  },
}))

jest.mock('@/lib/team', () => ({
  getDefaultTeam: (...a: unknown[]) => mockGetDefaultTeam(...a),
}))

// LUM-680: updateStatement now records a STATEMENT_CHANGED activity — mock the
// repo so this unit test doesn't reach prisma.
jest.mock('@/lib/repositories/idea-activity.repository', () => ({
  ideaActivityRepository: { create: jest.fn(), listByIdea: jest.fn() },
}))

import { ideaService } from '@/lib/services/idea.service'

const TEAM = { id: 'team-1', identifier: 'LUM' }

const ROW = {
  id: 'i1',
  number: 4,
  statement: 'ship the detail slide-over',
  status: 'CAPTURED',
  sourceContext: 'from the standup',
  sourceSessionId: 'sess-1',
  sourceTaskId: 'LUM-9',
  proposedByMemberId: 'm1',
  teamId: 'team-1',
  workspaceId: 'w1',
  createdAt: new Date('2026-07-04T10:00:00.000Z'),
  planRunId: null,
  initiative: null,
}

beforeEach(() => jest.clearAllMocks())

describe('ideaService.updateStatement', () => {
  it('updates the statement of an idea in the caller team', async () => {
    mockGetDefaultTeam.mockResolvedValue(TEAM)
    mockUpdateStatementInTeam.mockResolvedValue({
      ...ROW,
      statement: 'sharpened statement',
    })

    const idea = await ideaService.updateStatement({
      workspaceId: 'w1',
      ideaId: 'i1',
      input: { statement: 'sharpened statement' },
    })

    // Team-scoped write: repo called with the resolved team id.
    expect(mockUpdateStatementInTeam).toHaveBeenCalledWith({
      ideaId: 'i1',
      teamId: 'team-1',
      statement: 'sharpened statement',
    })
    // Returns a pooled idea with the human identifier + new statement.
    expect(idea.identifier).toBe('LUM-I4')
    expect(idea.statement).toBe('sharpened statement')
  })

  it('trims the statement before writing and rejects a blank one with 400', async () => {
    mockGetDefaultTeam.mockResolvedValue(TEAM)

    await expect(
      ideaService.updateStatement({
        workspaceId: 'w1',
        ideaId: 'i1',
        input: { statement: '   ' },
      })
    ).rejects.toMatchObject({ status: 400 })

    // Never reaches the repository on a blank statement.
    expect(mockUpdateStatementInTeam).not.toHaveBeenCalled()
  })

  it('throws 404 for an idea outside the caller team', async () => {
    mockGetDefaultTeam.mockResolvedValue(TEAM)
    // Repo returns null → the id is not in this team (or missing).
    mockUpdateStatementInTeam.mockResolvedValue(null)

    await expect(
      ideaService.updateStatement({
        workspaceId: 'w1',
        ideaId: 'other-team-idea',
        input: { statement: 'valid text' },
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when the workspace has no default team', async () => {
    mockGetDefaultTeam.mockResolvedValue(null)

    await expect(
      ideaService.updateStatement({
        workspaceId: 'w1',
        ideaId: 'i1',
        input: { statement: 'valid text' },
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mockUpdateStatementInTeam).not.toHaveBeenCalled()
  })
})
