import {
  formatOperationCost,
  type OperationCostResponse,
} from '../../src/commands/cost'

const data: OperationCostResponse = {
  version: 1,
  scope: { kind: 'task', label: 'LUM-1' },
  grandTotal: {
    input: 8,
    output: 14,
    cacheRead: 100,
    cacheCreation: 6,
    total: 128,
  },
  coverage: { toolTurns: 4, perStepTurns: 3, perStepPct: 0.75 },
  byTool: [
    {
      key: 'Bash',
      label: 'Bash',
      input: 5,
      output: 10,
      cacheRead: 60,
      cacheCreation: 4,
      total: 79,
    },
    {
      key: 'Read',
      label: 'Read',
      input: 3,
      output: 4,
      cacheRead: 40,
      cacheCreation: 2,
      total: 49,
    },
  ],
  byModel: [],
  byMember: [],
  bySession: [],
}

describe('formatOperationCost', () => {
  it('renders the by-tool ranking with all four token-category columns', () => {
    const out = formatOperationCost(data, 'tool')
    expect(out).toContain('Bash')
    expect(out).toContain('Read')
    expect(out).toMatch(/output/i)
    expect(out).toMatch(/input/i)
    expect(out).toMatch(/cache_create/i)
    expect(out).toMatch(/cache_read/i)
  })

  it('prints per-tool input and cache_create values in the ranking', () => {
    const out = formatOperationCost(data, 'tool')
    const bashRow = out.split('\n').find(l => l.startsWith('  Bash'))
    // Bash row: output 10 · input 5 · cache_create 4 · cache_read 60 · total 79
    expect(bashRow).toMatch(/\b5\b/)
    expect(bashRow).toMatch(/\b4\b/)
    expect(bashRow).toMatch(/\b79\b/)
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
