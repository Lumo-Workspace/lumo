import {
  attributeOperationCost,
  summarizeOperationPrecision,
  THINKING_BUCKET,
  type OperationCostEvent,
} from '@/lib/agent-run/operation-cost'

const M = 'claude-opus-4-8'
function u(
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation = 0
) {
  return { [M]: { input, output, cacheRead, cacheCreation } }
}
function ev(
  partial: Partial<OperationCostEvent> & Pick<OperationCostEvent, 'type'>
): OperationCostEvent {
  return {
    sessionId: 's1',
    workspaceMemberId: 'm1',
    toolName: null,
    usageByModel: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...partial,
  }
}
function totalOf(
  rows: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
  }[]
) {
  return rows.reduce(
    (t, r) => t + r.input + r.output + r.cacheRead + r.cacheCreation,
    0
  )
}

describe('attributeOperationCost', () => {
  it('attributes each step delta to the tool that ran in that step', () => {
    const at = (s: number) =>
      new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
    const events: OperationCostEvent[] = [
      ev({ type: 'POST_TOOL_USE', toolName: 'Bash', createdAt: at(1) }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 10, 0),
        createdAt: at(2),
      }),
      ev({ type: 'POST_TOOL_USE', toolName: 'Read', createdAt: at(3) }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 4, 0),
        createdAt: at(4),
      }),
      ev({ type: 'STOP', usageByModel: u(0, 16, 0), createdAt: at(5) }),
    ]
    const { rows } = attributeOperationCost(events)
    const out = (tool: string) =>
      rows.filter(r => r.tool === tool).reduce((t, r) => t + r.output, 0)
    expect(out('Bash')).toBe(10)
    expect(out('Read')).toBe(4)
    expect(out(THINKING_BUCKET)).toBe(2)
    expect(totalOf(rows)).toBe(16)
  })

  it('splits a shared batch evenly across parallel tool invocations', () => {
    const at = (s: number) =>
      new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
    const events: OperationCostEvent[] = [
      ev({ type: 'POST_TOOL_USE', toolName: 'Read', createdAt: at(1) }),
      ev({ type: 'POST_TOOL_USE', toolName: 'Read', createdAt: at(2) }),
      ev({ type: 'POST_TOOL_USE', toolName: 'Grep', createdAt: at(3) }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 9, 0),
        createdAt: at(4),
      }),
      ev({ type: 'STOP', usageByModel: u(0, 9, 0), createdAt: at(5) }),
    ]
    const { rows } = attributeOperationCost(events)
    const out = (tool: string) =>
      rows.filter(r => r.tool === tool).reduce((t, r) => t + r.output, 0)
    expect(out('Read')).toBeCloseTo(6)
    expect(out('Grep')).toBeCloseTo(3)
    expect(totalOf(rows)).toBeCloseTo(9)
  })

  it('falls back to whole-turn split when a turn has tools but no batch', () => {
    const at = (s: number) =>
      new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
    const events: OperationCostEvent[] = [
      ev({ type: 'POST_TOOL_USE', toolName: 'Bash', createdAt: at(1) }),
      ev({ type: 'POST_TOOL_USE', toolName: 'Edit', createdAt: at(2) }),
      ev({ type: 'STOP', usageByModel: u(0, 8, 0), createdAt: at(3) }),
    ]
    const { rows, coverage } = attributeOperationCost(events)
    const out = (tool: string) =>
      rows.filter(r => r.tool === tool).reduce((t, r) => t + r.output, 0)
    expect(out('Bash')).toBeCloseTo(4)
    expect(out('Edit')).toBeCloseTo(4)
    expect(coverage.toolTurns).toBe(1)
    expect(coverage.perStepTurns).toBe(0)
  })

  it('routes a pure-thinking turn entirely to the thinking bucket and excludes it from coverage', () => {
    const at = (s: number) =>
      new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
    const events: OperationCostEvent[] = [
      ev({ type: 'STOP', usageByModel: u(0, 5, 0), createdAt: at(1) }),
    ]
    const { rows, coverage } = attributeOperationCost(events)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tool).toBe(THINKING_BUCKET)
    expect(coverage.toolTurns).toBe(0)
  })

  it('tolerates a null STOP delta historical row without throwing', () => {
    const at = (s: number) =>
      new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
    const events: OperationCostEvent[] = [
      ev({ type: 'POST_TOOL_USE', toolName: 'Bash', createdAt: at(1) }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 3, 0),
        createdAt: at(2),
      }),
      ev({ type: 'STOP', usageByModel: null, createdAt: at(3) }),
    ]
    const { rows } = attributeOperationCost(events)
    const out = (tool: string) =>
      rows.filter(r => r.tool === tool).reduce((t, r) => t + r.output, 0)
    expect(out('Bash')).toBe(3)
  })

  it('splits Bash rows by toolDetail category', () => {
    const at = (s: number) =>
      new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
    const events: OperationCostEvent[] = [
      ev({
        type: 'POST_TOOL_USE',
        toolName: 'Bash',
        toolDetail: 'read',
        createdAt: at(1),
      }),
      ev({
        type: 'POST_TOOL_USE',
        toolName: 'Bash',
        toolDetail: 'test',
        createdAt: at(2),
      }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 10, 0),
        createdAt: at(3),
      }),
      // Pre-LUM-840 row (no toolDetail) and an unknown slug stay plain `Bash`.
      ev({ type: 'POST_TOOL_USE', toolName: 'Bash', createdAt: at(4) }),
      ev({
        type: 'POST_TOOL_USE',
        toolName: 'Bash',
        toolDetail: 'bogus',
        createdAt: at(5),
      }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 6, 0),
        createdAt: at(6),
      }),
      // toolDetail on a non-Bash tool is ignored.
      ev({
        type: 'POST_TOOL_USE',
        toolName: 'Read',
        toolDetail: 'read',
        createdAt: at(7),
      }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 4, 0),
        createdAt: at(8),
      }),
      ev({ type: 'STOP', usageByModel: u(0, 20, 0), createdAt: at(9) }),
    ]
    const { rows } = attributeOperationCost(events)
    const out = (tool: string) =>
      rows.filter(r => r.tool === tool).reduce((t, r) => t + r.output, 0)
    expect(out('Bash · read/search')).toBe(5)
    expect(out('Bash · test')).toBe(5)
    expect(out('Bash')).toBe(6)
    expect(out('Read')).toBe(4)
    expect(out(THINKING_BUCKET)).toBe(0)
    expect(totalOf(rows)).toBe(20)
  })

  it('breaks Bash rows down by command', () => {
    const at = (s: number) =>
      new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
    const events: OperationCostEvent[] = [
      ev({
        type: 'POST_TOOL_USE',
        toolName: 'Bash',
        toolDetail: 'read',
        toolVerb: 'grep',
        createdAt: at(1),
      }),
      ev({
        type: 'POST_TOOL_USE',
        toolName: 'Bash',
        toolDetail: 'read',
        toolVerb: 'cat',
        createdAt: at(2),
      }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 8, 0),
        createdAt: at(3),
      }),
      // toolVerb on a tool that is not a split Bash row is ignored.
      ev({
        type: 'POST_TOOL_USE',
        toolName: 'Read',
        toolVerb: 'grep',
        createdAt: at(4),
      }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 2, 0),
        createdAt: at(5),
      }),
      ev({ type: 'STOP', usageByModel: u(0, 10, 0), createdAt: at(6) }),
    ]
    const { rows } = attributeOperationCost(events)
    const out = (tool: string, verb: string | null) =>
      rows
        .filter(r => r.tool === tool && r.verb === verb)
        .reduce((t, r) => t + r.output, 0)
    expect(out('Bash · read/search', 'grep')).toBe(4)
    expect(out('Bash · read/search', 'cat')).toBe(4)
    expect(out('Read', null)).toBe(2)
    expect(totalOf(rows)).toBe(10)
  })
})

describe('attributeOperationCost — SUBAGENT_STOP (LUM-932)', () => {
  const at = (s: number) =>
    new Date(`2026-06-01T00:00:${String(s).padStart(2, '0')}Z`)
  const out = (rows: { tool: string; output: number }[], tool: string) =>
    rows.filter(r => r.tool === tool).reduce((t, r) => t + r.output, 0)

  it('ignores a SUBAGENT_STOP on a top-level session mid-turn', () => {
    const base: OperationCostEvent[] = [
      ev({ type: 'POST_TOOL_USE', toolName: 'Bash', createdAt: at(1) }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 10, 0),
        createdAt: at(2),
      }),
      ev({ type: 'POST_TOOL_USE', toolName: 'Read', createdAt: at(4) }),
      ev({ type: 'STOP', usageByModel: u(0, 16, 0), createdAt: at(5) }),
    ]
    const withHistorical = [
      ...base,
      // Historical row: a subagent finished on the PARENT session, mid-turn.
      ev({
        type: 'SUBAGENT_STOP',
        usageByModel: u(0, 3, 0),
        createdAt: at(3),
      }),
    ]
    const a = attributeOperationCost(base)
    const b = attributeOperationCost(withHistorical)
    expect(b).toEqual(a)
    expect(out(b.rows, 'Bash')).toBe(10)
    expect(out(b.rows, 'Read')).toBe(6)
    expect(totalOf(b.rows)).toBe(16)
  })

  it("attributes a child session's SUBAGENT_STOP usage to its preceding tools", () => {
    const child = 'sess-parent:agent1'
    const events: OperationCostEvent[] = [
      ev({
        sessionId: child,
        type: 'POST_TOOL_USE',
        toolName: 'Grep',
        createdAt: at(1),
      }),
      ev({
        sessionId: child,
        type: 'POST_TOOL_USE',
        toolName: 'Read',
        createdAt: at(2),
      }),
      ev({
        sessionId: child,
        type: 'SUBAGENT_STOP',
        usageByModel: u(0, 8, 0),
        createdAt: at(3),
      }),
    ]
    const { rows, coverage } = attributeOperationCost(events)
    expect(out(rows, 'Grep')).toBeCloseTo(4)
    expect(out(rows, 'Read')).toBeCloseTo(4)
    expect(totalOf(rows)).toBeCloseTo(8)
    expect(rows.every(r => r.sessionId === child)).toBe(true)
    expect(coverage.toolTurns).toBe(1)
  })

  it('keeps tools across usage-less batches so a child turn is not billed to thinking (LUM-1294)', () => {
    // Child events never carry usage: each step's POST_TOOL_BATCH arrives
    // empty and the whole delta is settled onto SUBAGENT_STOP later.
    const child = 'sess-parent:agent1'
    const events: OperationCostEvent[] = [
      ev({
        sessionId: child,
        type: 'POST_TOOL_USE',
        toolName: 'Grep',
        createdAt: at(1),
      }),
      ev({ sessionId: child, type: 'POST_TOOL_BATCH', createdAt: at(2) }),
      ev({
        sessionId: child,
        type: 'POST_TOOL_USE',
        toolName: 'Read',
        createdAt: at(3),
      }),
      ev({ sessionId: child, type: 'POST_TOOL_BATCH', createdAt: at(4) }),
      ev({
        sessionId: child,
        type: 'SUBAGENT_STOP',
        usageByModel: u(0, 8, 0),
        createdAt: at(5),
      }),
    ]
    const { rows, coverage } = attributeOperationCost(events)
    expect(out(rows, THINKING_BUCKET)).toBe(0)
    expect(out(rows, 'Grep')).toBeCloseTo(4)
    expect(out(rows, 'Read')).toBeCloseTo(4)
    expect(totalOf(rows)).toBeCloseTo(8)
    expect(coverage).toEqual({ toolTurns: 1, perStepTurns: 0 })
  })

  it('a usage-less batch still lets the next measured batch bill only its own step', () => {
    const events: OperationCostEvent[] = [
      ev({ type: 'POST_TOOL_USE', toolName: 'Grep', createdAt: at(1) }),
      ev({ type: 'POST_TOOL_BATCH', createdAt: at(2) }),
      ev({ type: 'POST_TOOL_USE', toolName: 'Read', createdAt: at(3) }),
      ev({
        type: 'POST_TOOL_BATCH',
        usageByModel: u(0, 6, 0),
        createdAt: at(4),
      }),
      ev({ type: 'STOP', usageByModel: u(0, 10, 0), createdAt: at(5) }),
    ]
    const { rows } = attributeOperationCost(events)
    // The measured batch covers both pending steps (Grep's own was unmeasured).
    expect(out(rows, 'Grep')).toBeCloseTo(3)
    expect(out(rows, 'Read')).toBeCloseTo(3)
    expect(out(rows, THINKING_BUCKET)).toBeCloseTo(4)
    expect(totalOf(rows)).toBeCloseTo(10)
  })
})

describe('summarizeOperationPrecision (LUM-1294)', () => {
  it('flags a thinking-only read-out and computes the cache-read share', () => {
    expect(
      summarizeOperationPrecision({
        grandTotal: { cacheRead: 96, total: 100 },
        perStepPct: 0,
        toolLabels: [THINKING_BUCKET],
      })
    ).toEqual({ perStepPct: 0, cacheReadPct: 0.96, hasToolRows: false })
  })

  it('reports tool rows and guards a zero total', () => {
    expect(
      summarizeOperationPrecision({
        grandTotal: { cacheRead: 0, total: 0 },
        perStepPct: null,
        toolLabels: [THINKING_BUCKET, 'Read'],
      })
    ).toEqual({ perStepPct: null, cacheReadPct: 0, hasToolRows: true })
  })
})
