/**
 * @jest-environment node
 *
 * LUM-678 (Spec2-16): Initiative model reshape — a schema-parse test asserting
 * the frozen shape directly against prisma/schema.prisma:
 *   - Initiative carries the Linear-aligned scalar fields (name/description/
 *     5-state status/priority/ownerMemberId/targetDate) while KEEPING the
 *     Lumo-specific assumptionNote (planRunId went with plan runs, LUM-1040).
 *   - The two-layer container: Milestone gains a nullable initiativeId
 *     (additive) and Task keeps its nullable initiativeId (direct attach).
 */
import { readFileSync } from 'fs'
import path from 'path'

const schema = readFileSync(
  path.resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8'
)

/** Extract the body of a `model <name> { … }` block from the schema text. */
function modelBlock(name: string): string {
  const re = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, 'm')
  const m = schema.match(re)
  if (!m?.[1]) throw new Error(`model ${name} not found in schema.prisma`)
  return m[1]
}

/** Extract the body of an `enum <name> { … }` block from the schema text. */
function enumBlock(name: string): string {
  const re = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`, 'm')
  const m = schema.match(re)
  if (!m?.[1]) throw new Error(`enum ${name} not found in schema.prisma`)
  return m[1]
}

describe('LUM-678 Initiative model reshape', () => {
  it('Initiative has Linear-aligned fields and keeps assumptionNote', () => {
    const init = modelBlock('Initiative')

    // ── Linear scalar fields ─────────────────────────────────────────────────
    // `name` is the required short title; `description` the optional body.
    expect(init).toMatch(/^\s*name\s+String\s*$/m)
    expect(init).toMatch(/^\s*description\s+String\?/m)
    // priority reuses TaskPriority and is nullable.
    expect(init).toMatch(/^\s*priority\s+TaskPriority\?/m)
    // owner + dates, all nullable.
    expect(init).toMatch(/^\s*ownerMemberId\s+String\?/m)
    expect(init).toMatch(/^\s*targetDate\s+DateTime\?/m)
    expect(init).toMatch(/^\s*startDate\s+DateTime\?/m)

    // ── a CLEAN 5-state Linear status enum (no legacy DONE/DROPPED) ──────────
    expect(init).toMatch(/^\s*status\s+InitiativeStatus\b/m)
    const status = enumBlock('InitiativeStatus')
    for (const state of [
      'PROPOSED',
      'PLANNED',
      'ACTIVE',
      'COMPLETED',
      'CANCELLED',
    ]) {
      expect(status).toMatch(new RegExp(`\\b${state}\\b`))
    }
    // The interim legacy values were dropped in the clean-up follow-up.
    expect(status).not.toMatch(/\bDONE\b/)
    expect(status).not.toMatch(/\bDROPPED\b/)

    // ── Lumo-specific fields KEPT (Linear has no equivalent) ─────────────────
    expect(init).toMatch(/^\s*assumptionNote\s+String\?/m)
    // LUM-1040: plan runs are gone, and their lineage column with them.
    expect(init).not.toMatch(/\bplanRunId\b/)

    // ── the redundant goalStatement column was dropped — `name` is canonical ──
    expect(init).not.toMatch(/\bgoalStatement\b/)
  })

  it('Milestone gains nullable initiativeId and Task direct attach is additive', () => {
    const milestone = modelBlock('Milestone')
    const task = modelBlock('Task')

    // ── Milestone: NEW nullable initiativeId + relation (additive) ───────────
    expect(milestone).toMatch(/^\s*initiativeId\s+String\?/m)
    expect(milestone).toMatch(
      /initiative\s+Initiative\?\s+@relation\(fields:\s*\[initiativeId\],\s*references:\s*\[id\]/
    )
    // Its existing project scoping is unchanged — projectId stays required.
    expect(milestone).toMatch(/^\s*projectId\s+String\s*$/m)

    // ── Task: initiativeId supports directly-attached tasks, still nullable ──
    expect(task).toMatch(/^\s*initiativeId\s+String\?/m)
    expect(task).toMatch(
      /initiative\s+Initiative\?\s+@relation\(fields:\s*\[initiativeId\],\s*references:\s*\[id\]/
    )
  })
})
