import {
  DEFAULT_RISK_CONFIG,
  resolveEffectiveRiskConfig,
  type RiskConfig,
} from '@/lib/summaries/risk'

const workspace = {
  riskOverdueRatio: 0.2,
  riskStalledDays: 5,
  riskStalledMinCount: 2,
  riskAgentFailRatio: 0.35,
  riskStalePrDays: 4,
  riskThroughputDrop: 0.4,
}

describe('resolveEffectiveRiskConfig', () => {
  it('returns workspace values when project is null', () => {
    expect(resolveEffectiveRiskConfig(workspace, null)).toEqual<RiskConfig>({
      overdueRatio: 0.2,
      stalledDays: 5,
      stalledMinCount: 2,
      agentFailRatio: 0.35,
      stalePrDays: 4,
      throughputDrop: 0.4,
    })
  })

  it('returns workspace values when project has all nulls', () => {
    const project = {
      riskOverdueRatio: null,
      riskStalledDays: null,
      riskStalledMinCount: null,
      riskAgentFailRatio: null,
      riskStalePrDays: null,
      riskThroughputDrop: null,
    }
    expect(resolveEffectiveRiskConfig(workspace, project)).toEqual({
      overdueRatio: 0.2,
      stalledDays: 5,
      stalledMinCount: 2,
      agentFailRatio: 0.35,
      stalePrDays: 4,
      throughputDrop: 0.4,
    })
  })

  it('per-field project override wins over workspace value', () => {
    const project = {
      riskOverdueRatio: 0.8,
      riskStalledDays: null,
      riskStalledMinCount: null,
      riskAgentFailRatio: null,
      riskStalePrDays: null,
      riskThroughputDrop: 0.1,
    }
    const resolved = resolveEffectiveRiskConfig(workspace, project)
    expect(resolved.overdueRatio).toBe(0.8)
    expect(resolved.throughputDrop).toBe(0.1)
    expect(resolved.stalledDays).toBe(5)
  })

  it('DEFAULT_RISK_CONFIG matches the documented defaults', () => {
    expect(DEFAULT_RISK_CONFIG).toEqual({
      overdueRatio: 0.25,
      stalledDays: 7,
      stalledMinCount: 3,
      agentFailRatio: 0.3,
      stalePrDays: 3,
      throughputDrop: 0.5,
    })
  })
})
