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

  it('prints the attribution caveat as a Note:, not a Hint: (LUM-1088)', () => {
    const out = formatOperationCost(data, 'tool')
    const line = out.split('\n').find(l => l.includes('heuristic'))
    expect(line).toMatch(/^Note: token→tool attribution is heuristic/)
    expect(out).not.toMatch(/^Hint:/m)
  })

  it('prints the top commands under a Bash row', () => {
    const out = formatOperationCost(
      {
        ...data,
        byTool: [
          {
            key: 'Bash · typecheck/lint/build',
            label: 'Bash · typecheck/lint/build',
            input: 0,
            output: 0,
            cacheRead: 90,
            cacheCreation: 0,
            total: 90,
            breakdown: [
              { key: 'tsc', label: 'tsc', input: 0, output: 0, cacheRead: 60, cacheCreation: 0, total: 60 }, // prettier-ignore
              { key: 'npm lint', label: 'npm lint', input: 0, output: 0, cacheRead: 30, cacheCreation: 0, total: 30 }, // prettier-ignore
            ],
          },
        ],
      },
      'tool'
    )
    const lines = out.split('\n')
    const parent = lines.findIndex(l =>
      l.includes('Bash · typecheck/lint/build')
    )
    expect(parent).toBeGreaterThan(-1)
    expect(lines[parent + 1]).toMatch(/↳ tsc\s+.*60/)
    expect(lines[parent + 2]).toMatch(/↳ npm lint\s+.*30/)
  })
})
