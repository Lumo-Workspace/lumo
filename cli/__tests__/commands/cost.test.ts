import {
  formatOperationCost,
  resolveCostSince,
  type OperationCostResponse,
} from '../../src/commands/cost'
import { localDayStart } from '../../src/lib/local-day'

jest.mock('../../src/lib/local-day', () => {
  const actual = jest.requireActual('../../src/lib/local-day')
  return { ...actual, localDayStart: jest.fn(actual.localDayStart) }
})

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

describe('resolveCostSince (LUM-1124)', () => {
  it('sends a bare day as the local midnight, not UTC midnight', () => {
    const iso = resolveCostSince('2026-10-12')!.iso
    // Whatever the shell's zone, the instant is the LOCAL start of the day.
    expect(iso).toBe(new Date(2026, 9, 12).toISOString())
    const d = new Date(iso)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2026, 9, 12, 0,
    ])
  })

  it('uses the shell-local day boundary, not UTC midnight (UTC+11)', () => {
    // Pin the zone: what local-day returns for a UTC+11 shell. A UTC parse of
    // the raw day would give 2026-10-12T00:00:00.000Z instead.
    ;(localDayStart as jest.Mock).mockReturnValueOnce(
      '2026-10-11T13:00:00.000Z'
    )
    expect(resolveCostSince('2026-10-12')).toEqual({
      iso: '2026-10-11T13:00:00.000Z',
      day: '2026-10-12',
    })
    expect(localDayStart).toHaveBeenLastCalledWith('2026-10-12')
  })

  it('passes a full ISO instant through untouched', () => {
    expect(resolveCostSince('2026-10-11T13:00:00.000Z')).toEqual({
      iso: '2026-10-11T13:00:00.000Z',
      day: null,
    })
  })

  it('rejects an impossible calendar day', () => {
    expect(resolveCostSince('2026-02-31')).toBeNull()
  })

  it('rejects values that are neither a day nor a timestamp', () => {
    expect(resolveCostSince('7d')).toBeNull()
    expect(resolveCostSince('last week')).toBeNull()
  })

  it('normalizes a zone-less timestamp in the shell zone', () => {
    expect(resolveCostSince('2026-10-12T09:30')).toEqual({
      iso: new Date(2026, 9, 12, 9, 30).toISOString(),
      day: null,
    })
  })
})

describe('formatOperationCost window title (LUM-1124)', () => {
  const ws: OperationCostResponse = {
    ...data,
    scope: { kind: 'workspace', label: 'since 2026-10-11T13:00:00.000Z' },
  }

  it('titles the window with the local day the user asked for', () => {
    const first = formatOperationCost(ws, 'tool', '2026-10-12').split('\n')[0]
    expect(first).toBe('Per-operation cost — workspace since 2026-10-12')
  })

  it('falls back to the server label without a local day', () => {
    const first = formatOperationCost(ws, 'tool').split('\n')[0]
    expect(first).toBe(
      'Per-operation cost — workspace since 2026-10-11T13:00:00.000Z'
    )
  })
})
