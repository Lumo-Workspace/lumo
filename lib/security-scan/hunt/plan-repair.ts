/**
 * LUM-776 — deterministic repair of a plan the model wrote in the wrong
 * ENVELOPE. Pure and dependency-free (like `plan-retry.ts`), tested without
 * mocks.
 *
 * The A/B probe on 24 real prompts (`scripts/analysis/lum776-plan-probe`)
 * showed the shipped call losing plans to two shapes that are not the model
 * being wrong about the plan, only about its wrapper:
 *
 *   - `{}` — zero reasoning tokens, two output tokens, ~1.5 s: the model did
 *     not engage and emitted an empty object with no `tasks` key. Production
 *     PR 994 was the same mode one step further along (`{"tasks": []}`).
 *   - `[ {…task}, {…task} ]` — 7 000 reasoning tokens and a real plan,
 *     returned as a bare array instead of `{"tasks": [ … ]}`.
 *
 * Both are one mechanical step from a valid document, and turning them into a
 * validation failure buys the deterministic fallback — which, for the second
 * shape, throws away the plan the model just spent its budget on. The repair
 * is recorded (`planRepair` on the audit) so a repaired plan can never be
 * mistaken for a reasoned one in the read-out.
 *
 * NOT repaired: anything that does not parse as JSON (a truncated document is
 * a budget problem — `finishReason: length` — and the retry path owns it) or
 * an object that HAS a `tasks` key but fails validation (that is a real shape
 * miss and must stay one).
 */

export type PlanRepairKind = 'wrapped-array' | 'missing-tasks'

export const PLAN_REPAIR_KINDS: readonly PlanRepairKind[] = [
  'wrapped-array',
  'missing-tasks',
]

export interface PlanRepair {
  text: string
  kind: PlanRepairKind
}

/**
 * Returns the repaired JSON text and what was done, or `null` when the text is
 * not one of the two repairable envelopes.
 */
export function repairPlanText(text: string): PlanRepair | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (Array.isArray(value)) {
    return { text: JSON.stringify({ tasks: value }), kind: 'wrapped-array' }
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (!('tasks' in obj) || obj.tasks === null || obj.tasks === undefined) {
      return {
        text: JSON.stringify({ ...obj, tasks: [] }),
        kind: 'missing-tasks',
      }
    }
  }
  return null
}
