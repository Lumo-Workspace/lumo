/**
 * LUM-776 — the two envelope mistakes the A/B probe caught the FAST bucket
 * making on real prompts, and the shapes that must NOT be repaired.
 */
import {
  repairPlanText,
  PLAN_REPAIR_KINDS,
} from '@/ee/security/security-scan/hunt/plan-repair'

describe('repairPlanText', () => {
  it('reads an empty object as an empty plan — the zero-reasoning `{}` the probe saw twice in 24', () => {
    expect(repairPlanText('{}')).toEqual({
      text: JSON.stringify({ tasks: [] }),
      kind: 'missing-tasks',
    })
    // …and one with only a reason.
    expect(repairPlanText('{"reason":"nothing to hunt"}')).toEqual({
      text: JSON.stringify({ reason: 'nothing to hunt', tasks: [] }),
      kind: 'missing-tasks',
    })
    expect(repairPlanText('{"tasks":null}')?.kind).toBe('missing-tasks')
  })

  it('wraps a bare task array — a real plan returned without its envelope', () => {
    const tasks = [
      { objective: 'o'.repeat(30), category: 'idor', startingPoints: ['a.ts'] },
    ]
    expect(repairPlanText(JSON.stringify(tasks))).toEqual({
      text: JSON.stringify({ tasks }),
      kind: 'wrapped-array',
    })
  })

  it('does not touch a document that is not JSON — a truncation is a budget problem, not an envelope one', () => {
    expect(
      repairPlanText('{"tasks":[{"objective":"trace the id from')
    ).toBeNull()
    expect(repairPlanText('')).toBeNull()
  })

  it('does not touch an object that HAS tasks — a real shape miss stays a shape miss', () => {
    expect(repairPlanText('{"tasks":[{"category":"nope"}]}')).toBeNull()
    expect(repairPlanText('{"tasks":"x"}')).toBeNull()
    expect(repairPlanText('42')).toBeNull()
    expect(repairPlanText('null')).toBeNull()
  })

  it('names every repair kind', () => {
    expect(PLAN_REPAIR_KINDS).toEqual(['wrapped-array', 'missing-tasks'])
  })
})
