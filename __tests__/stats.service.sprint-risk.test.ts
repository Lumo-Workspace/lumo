/**
 * @jest-environment node
 */
import { getSprintRisk } from '@/lib/services/stats.service'

const findWorkspaceWithRiskConfig = jest.fn()
const aggregateSprintRisk = jest.fn()

jest.mock('@/lib/repositories/stats.repository', () => ({
  statsRepository: {
    findWorkspaceWithRiskConfig: (id: string) =>
      findWorkspaceWithRiskConfig(id),
  },
}))

jest.mock('@/lib/summaries/stats', () => ({
  aggregateProjectStats: jest.fn(),
  aggregateWorkspaceStats: jest.fn(),
  aggregateSprintRisk: (sprintId: string, config: unknown) =>
    aggregateSprintRisk(sprintId, config),
}))

const WORKSPACE_CONFIG = {
  riskOverdueRatio: 0.25,
  riskStalledDays: 7,
  riskStalledMinCount: 3,
  riskAgentFailRatio: 0.3,
  riskStalePrDays: 3,
  riskThroughputDrop: 0.5,
}

describe('getSprintRisk', () => {
  beforeEach(() => {
    findWorkspaceWithRiskConfig.mockReset()
    aggregateSprintRisk.mockReset()
  })

  it('resolves the workspace risk config and delegates to aggregateSprintRisk', async () => {
    findWorkspaceWithRiskConfig.mockResolvedValue(WORKSPACE_CONFIG)
    const expected = {
      risk: { level: 'watch', score: 3, reasons: [] },
      topBlockers: {
        overdueTaskIds: [],
        stalledTaskIds: [],
        failingAgentTaskIds: [],
        staleOpenPrNumbers: [],
      },
    }
    aggregateSprintRisk.mockResolvedValue(expected)

    const result = await getSprintRisk('sprint_1', 'ws_1')

    expect(findWorkspaceWithRiskConfig).toHaveBeenCalledWith('ws_1')
    // Workspace baseline maps into the effective RiskConfig (sprints carry no
    // overrides — second arg to resolveEffectiveRiskConfig is null).
    expect(aggregateSprintRisk).toHaveBeenCalledWith('sprint_1', {
      overdueRatio: 0.25,
      stalledDays: 7,
      stalledMinCount: 3,
      agentFailRatio: 0.3,
      stalePrDays: 3,
      throughputDrop: 0.5,
    })
    expect(result).toBe(expected)
  })

  it('throws a 404 when the workspace is missing', async () => {
    findWorkspaceWithRiskConfig.mockResolvedValue(null)
    await expect(getSprintRisk('sprint_1', 'ws_missing')).rejects.toMatchObject({
      status: 404,
    })
    expect(aggregateSprintRisk).not.toHaveBeenCalled()
  })
})
