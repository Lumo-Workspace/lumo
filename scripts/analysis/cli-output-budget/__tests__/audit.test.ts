/**
 * @jest-environment node
 *
 * LUM-428 — tests for the agent-facing CLI output-token-budget audit. The
 * checkpointer name below is wired into the task's MACHINE acceptance criteria;
 * keep it byte-stable.
 */
import { auditAgentFacingCommands, renderReport, BUDGET } from '../audit'

describe('cli-output-budget audit', () => {
  it('cli-output-budget audit enumerates agent-facing commands and flags unbounded ones', () => {
    const rows = auditAgentFacingCommands()
    const commands = rows.map(r => r.command)

    // 1) Coverage: every agent-facing command this audit is responsible for is
    // enumerated — the five render/aggregate commands plus the three
    // byte-faithful doc reads.
    const expected = [
      'lumo task comments list <id>',
      'lumo doc show <doc>',
      'lumo task context <id>',
      'lumo task lineage <id>',
      'lumo task status <id>',
      'lumo doc show <doc> --raw',
      'lumo doc show <doc> --section <heading>',
      'lumo doc diff <doc>',
    ]
    for (const c of expected) expect(commands).toContain(c)

    // 2) The byte-faithful reads are EXEMPT — they must stay full (an edit base
    // for `doc patch`), so the audit never marks them capped and the agent
    // still receives every byte even though they dwarf the budget.
    const byteFaithful = rows.filter(r => r.kind === 'byte-faithful')
    expect(byteFaithful.map(r => r.command).sort()).toEqual(
      [
        'lumo doc diff <doc>',
        'lumo doc show <doc> --raw',
        'lumo doc show <doc> --section <heading>',
      ].sort()
    )
    for (const r of byteFaithful) {
      expect(r.exempt).toBe(true)
      expect(r.flaggedUnbounded).toBe(false)
      expect(r.cappedInV1).toBe(false)
      // Stays full: extreme output far exceeds the budget and is NOT truncated.
      expect(r.extremeActualTokens).toBeGreaterThan(BUDGET)
      expect(r.extremeActualTokens).toBe(r.extremeUncappedTokens)
      expect(r.fetchPointer).toBeNull()
    }

    // 3) The audit actually FLAGS unbounded commands — and every flagged one is
    // a render/aggregate command whose realistic output blows the budget.
    const flagged = rows.filter(r => r.flaggedUnbounded)
    expect(flagged.length).toBeGreaterThan(0)
    for (const r of flagged) {
      expect(r.exempt).toBe(false)
      expect(r.realisticUncappedTokens).toBeGreaterThan(BUDGET)
    }

    // 4) Every flagged command is capped in v1: it now has a hard ceiling, the
    // agent receives ≤ budget even at an extreme input, and a fetch-more
    // pointer tells it how to pull the rest.
    for (const r of flagged) {
      expect(r.cappedInV1).toBe(true)
      expect(r.hasOutputCeiling).toBe(true)
      expect(r.extremeActualTokens).toBeLessThanOrEqual(BUDGET)
      expect(r.fetchPointer).not.toBeNull()
    }
    // The three highest-risk render paths are exactly the ones flagged+capped.
    expect(flagged.map(r => r.command).sort()).toEqual(
      [
        'lumo doc show <doc>',
        'lumo task comments list <id>',
        'lumo task context <id>',
      ].sort()
    )

    // 5) Measure-first discipline: the render/aggregate commands NOT capped were
    // measured to stay within budget at realistic input — so deferring their
    // cap is justified, not an oversight.
    const uncappedRender = rows.filter(
      r => r.kind === 'render-aggregate' && !r.cappedInV1
    )
    expect(uncappedRender.map(r => r.command).sort()).toEqual(
      ['lumo task lineage <id>', 'lumo task status <id>'].sort()
    )
    for (const r of uncappedRender) {
      expect(r.flaggedUnbounded).toBe(false)
      expect(r.realisticActualTokens).toBeLessThanOrEqual(BUDGET)
    }

    // The report renders without throwing and names the budget anchor.
    const report = renderReport(rows)
    expect(report).toContain(`${BUDGET.toLocaleString('en-US')} tokens`)
    expect(report).toContain('CAPPED in v1')
  })
})
