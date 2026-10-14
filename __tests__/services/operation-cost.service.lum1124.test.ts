import type { OperationCostRow } from '@/lib/agent-run/operation-cost'

jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findToolAttributionEvents: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { labelsByIds: jest.fn(async () => new Map()) },
}))
jest.mock('@/lib/agent-run/operation-cost', () => ({
  attributeOperationCost: jest.fn(),
}))

import { attributeOperationCost } from '@/lib/agent-run/operation-cost'
import {
  foldRows,
  operationCostService,
  roundRow,
  sessionLabels,
  withCommandBreakdown,
} from '@/lib/services/operation-cost.service'

const PARENT = 'a6be42a4-1111-2222-3333-444455556666'

const row = (p: Partial<OperationCostRow>): OperationCostRow => ({
  tool: 'Bash',
  verb: null,
  model: 'claude-opus-5-5',
  sessionId: PARENT,
  workspaceMemberId: 'm1',
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  ...p,
})

function attributes(rows: OperationCostRow[]) {
  ;(attributeOperationCost as jest.Mock).mockReturnValue({
    rows,
    coverage: { toolTurns: 0, perStepTurns: 0 },
  })
}

describe('getOperationCost scope label (LUM-1124)', () => {
  beforeEach(() => attributes([]))

  it('titles a --since window by its start, not "last 30d"', async () => {
    const since = new Date('2026-10-11T13:00:00.000Z')
    const res = await operationCostService.getOperationCost('w1', {
      kind: 'workspace',
      since,
    })
    expect(res!.scope.label).toBe('since 2026-10-11T13:00:00.000Z')
  })

  it('keeps "last 30d" when no --since is given', async () => {
    const res = await operationCostService.getOperationCost('w1', {
      kind: 'workspace',
    })
    expect(res!.scope.label).toBe('last 30d')
  })
})

describe('getOperationCost By session labels (LUM-1124)', () => {
  it('gives each subagent of one parent a distinct label', async () => {
    attributes([
      row({ sessionId: PARENT, output: 9 }),
      row({ sessionId: `${PARENT}:agentAAAA1`, output: 5 }),
      row({ sessionId: `${PARENT}:agentBBBB2`, output: 3 }),
    ])
    const res = await operationCostService.getOperationCost('w1', {
      kind: 'workspace',
    })
    const labels = res!.bySession.map(r => r.label)
    expect(new Set(labels).size).toBe(3)
    expect(labels).toEqual([
      'a6be42a4',
      'a6be42a4:agentAAA',
      'a6be42a4:agentBBB',
    ])
    // The full id stays in `key`, ready for `lumo cost --session <id>`.
    expect(res!.bySession[1]!.key).toBe(`${PARENT}:agentAAAA1`)
  })
})

describe('sessionLabels', () => {
  it('grows the prefix until colliding labels differ', () => {
    const a = `${PARENT}:abcdefgh1`
    const b = `${PARENT}:abcdefgh2`
    const labels = sessionLabels([a, b])
    expect(labels.get(a)).toBe('a6be42a4-:abcdefgh1')
    expect(labels.get(b)).toBe('a6be42a4-:abcdefgh2')
  })

  it('leaves plain sessions and "(none)" at 8 chars', () => {
    const labels = sessionLabels([PARENT, 'bbbbbbbb-9999', '(none)'])
    expect([...labels.values()]).toEqual(['a6be42a4', 'bbbbbbbb', '(none)'])
  })
})

describe('getOperationCost rounding (LUM-1124)', () => {
  it('returns whole tokens in the grand total and every row', async () => {
    // A parallel-tool step split three ways leaves float noise.
    attributes([
      row({ tool: 'Read', input: 10228 / 3, cacheRead: 100 / 3 }),
      row({ tool: 'Grep', input: 10228 / 3, cacheRead: 100 / 3 }),
      row({ tool: 'Edit', input: 10228 / 3, cacheRead: 100 / 3 }),
    ])
    const res = await operationCostService.getOperationCost('w1', {
      kind: 'workspace',
    })
    const all = [
      res!.grandTotal,
      ...res!.byTool,
      ...res!.byModel,
      ...res!.byMember,
      ...res!.bySession,
    ]
    for (const r of all) {
      for (const v of [
        r.input,
        r.output,
        r.cacheRead,
        r.cacheCreation,
        r.total,
      ]) {
        expect(Number.isInteger(v)).toBe(true)
      }
    }
    expect(res!.grandTotal.input).toBe(10228)
    expect(res!.grandTotal.total).toBe(10228 + 100)
  })

  it('roundRow rebuilds the total from the rounded parts', () => {
    const r = roundRow({
      input: 1.4,
      output: 1.4,
      cacheRead: 1.4,
      cacheCreation: 0,
      total: 4.2,
    })
    expect(r).toEqual({
      input: 1,
      output: 1,
      cacheRead: 1,
      cacheCreation: 0,
      total: 3,
    })
  })
})

describe('withCommandBreakdown after rounding (LUM-1124)', () => {
  it('keeps the per-command rows summing exactly to their parent', () => {
    // Three commands each holding 1.4 tokens: rounded one by one they are
    // 1 + 1 + 1, while the raw parent (4.2) would round to 4.
    const rows = ['grep', 'sed', 'cat'].map(verb =>
      row({ tool: 'Bash · read/search', verb, output: 1.4 })
    )
    const byTool = withCommandBreakdown(
      rows,
      foldRows(
        rows,
        r => r.tool,
        () => undefined
      )
    )
    const bash = byTool[0]!
    expect(bash.breakdown!.reduce((t, c) => t + c.output, 0)).toBe(bash.output)
    expect(bash.breakdown!.reduce((t, c) => t + c.total, 0)).toBe(bash.total)
    expect(bash.output).toBe(3)
  })
})
