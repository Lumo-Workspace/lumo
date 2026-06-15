import { foldRows } from '@/lib/services/operation-cost.service'
import type { OperationCostRow } from '@/lib/agent-run/operation-cost'

const row = (p: Partial<OperationCostRow>): OperationCostRow => ({
  tool: 'Bash',
  model: 'claude-opus-4-8',
  sessionId: 's1',
  workspaceMemberId: 'm1',
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  ...p,
})

describe('foldRows', () => {
  it('groups by tool and sorts by total desc', () => {
    const rows = [
      row({ tool: 'Bash', output: 10 }),
      row({ tool: 'Read', output: 4 }),
      row({ tool: 'Bash', output: 6 }),
    ]
    const folded = foldRows(
      rows,
      r => r.tool,
      () => undefined
    )
    expect(folded.map(r => [r.key, r.total])).toEqual([
      ['Bash', 16],
      ['Read', 4],
    ])
  })

  it('uses the label resolver falling back to the key', () => {
    const rows = [row({ workspaceMemberId: 'm1', output: 3 })]
    const labels = new Map([['m1', 'Alice']])
    const folded = foldRows(
      rows,
      r => r.workspaceMemberId ?? '(unknown)',
      k => labels.get(k)
    )
    expect(folded[0]!.label).toBe('Alice')
  })
})
