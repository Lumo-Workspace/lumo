import {
  foldRows,
  UNLABELLED_COMMAND,
  withCommandBreakdown,
} from '@/lib/services/operation-cost.service'
import type { OperationCostRow } from '@/lib/agent-run/operation-cost'

const row = (p: Partial<OperationCostRow>): OperationCostRow => ({
  tool: 'Bash',
  verb: null,
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

describe('withCommandBreakdown', () => {
  it('returns a per-command breakdown under Bash rows', () => {
    const rows = [
      row({ tool: 'Bash · read/search', verb: 'grep', output: 6 }),
      row({ tool: 'Bash · read/search', verb: 'cat', output: 3 }),
      row({ tool: 'Bash · read/search', verb: 'grep', output: 2 }),
      row({ tool: 'Bash · read/search', verb: null, output: 1 }),
      row({ tool: 'Read', output: 5 }),
    ]
    const byTool = withCommandBreakdown(
      rows,
      foldRows(
        rows,
        r => r.tool,
        () => undefined
      )
    )
    const bash = byTool.find(r => r.key === 'Bash · read/search')!
    expect(bash.total).toBe(12)
    expect(bash.breakdown!.map(b => [b.label, b.total])).toEqual([
      ['grep', 8],
      ['cat', 3],
      [UNLABELLED_COMMAND, 1],
    ])
    expect(bash.breakdown!.reduce((t, b) => t + b.total, 0)).toBe(bash.total)
    // Tools without commands carry no breakdown.
    expect(byTool.find(r => r.key === 'Read')!.breakdown).toBeUndefined()
  })
})
