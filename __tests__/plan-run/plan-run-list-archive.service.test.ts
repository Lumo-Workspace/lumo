/**
 * LUM-677: the plan-run list + archive service. Drives the real service over a
 * mocked repository + team resolver. Proves the team scoping (list resolves the
 * caller workspace's default team; missing team → 404) and the archive's
 * workspace guard (a run in another workspace is reported as 404, never leaked).
 */
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: { listByTeam: jest.fn(), findArchiveById: jest.fn() },
}))
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))

import { planRunService } from '@/lib/services/plan-run.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { getDefaultTeam as getDefaultTeamImpl } from '@/lib/team'

const listByTeam = planRunRepository.listByTeam as jest.Mock
const findArchiveById = planRunRepository.findArchiveById as jest.Mock
const getDefaultTeam = getDefaultTeamImpl as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('planRunService.listRuns', () => {
  it('resolves the default team and lists its runs', async () => {
    getDefaultTeam.mockResolvedValue({ id: 'team-1' })
    listByTeam.mockResolvedValue([{ id: 'run-1' }])

    const runs = await planRunService.listRuns({ workspaceId: 'w1' })

    expect(getDefaultTeam).toHaveBeenCalledWith('w1')
    expect(listByTeam).toHaveBeenCalledWith('team-1')
    expect(runs).toEqual([{ id: 'run-1' }])
  })

  it('throws 404 when the workspace has no default team', async () => {
    getDefaultTeam.mockResolvedValue(null)

    await expect(
      planRunService.listRuns({ workspaceId: 'w1' })
    ).rejects.toMatchObject({ status: 404 })
    expect(listByTeam).not.toHaveBeenCalled()
  })
})

describe('planRunService.getArchive', () => {
  it('returns the archive for a run in the caller workspace', async () => {
    const run = { id: 'run-1', workspaceId: 'w1', stageRecords: [] }
    findArchiveById.mockResolvedValue(run)

    expect(
      await planRunService.getArchive({ runId: 'run-1', workspaceId: 'w1' })
    ).toBe(run)
  })

  it('reports a run in another workspace as 404 (never leaks it)', async () => {
    findArchiveById.mockResolvedValue({
      id: 'run-1',
      workspaceId: 'other-ws',
      stageRecords: [],
    })

    await expect(
      planRunService.getArchive({ runId: 'run-1', workspaceId: 'w1' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when the run does not exist', async () => {
    findArchiveById.mockResolvedValue(null)

    await expect(
      planRunService.getArchive({ runId: 'missing', workspaceId: 'w1' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
