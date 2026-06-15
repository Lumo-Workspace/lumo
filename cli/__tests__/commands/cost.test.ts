import {
  formatOperationCost,
  type OperationCostResponse,
} from '../../src/commands/cost'

const data: OperationCostResponse = {
  version: 1,
  scope: { kind: 'task', label: 'LUM-1' },
  grandTotal: {
    input: 0,
    output: 14,
    cacheRead: 100,
    cacheCreation: 0,
    total: 114,
  },
  coverage: { toolTurns: 4, perStepTurns: 3, perStepPct: 0.75 },
  byTool: [
    {
      key: 'Bash',
      label: 'Bash',
      input: 0,
      output: 10,
      cacheRead: 60,
      cacheCreation: 0,
      total: 70,
    },
    {
      key: 'Read',
      label: 'Read',
      input: 0,
      output: 4,
      cacheRead: 40,
      cacheCreation: 0,
      total: 44,
    },
  ],
  byModel: [],
  byMember: [],
  bySession: [],
}

describe('formatOperationCost', () => {
  it('renders the by-tool ranking with output and cache read columns', () => {
    const out = formatOperationCost(data, 'tool')
    expect(out).toContain('Bash')
    expect(out).toContain('Read')
    expect(out).toMatch(/output/i)
    expect(out).toMatch(/cache/i)
  })

  it('prints the per-step coverage line', () => {
    const out = formatOperationCost(data, 'tool')
    expect(out).toContain('75%')
  })

  it('notes the attribution is heuristic', () => {
    const out = formatOperationCost(data, 'tool')
    expect(out.toLowerCase()).toContain('heuristic')
  })
})
