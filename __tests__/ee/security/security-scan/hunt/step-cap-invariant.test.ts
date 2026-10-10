/** @jest-environment node */
/**
 * LUM-794 — the invariant behind this whole task, applied to our own hunt.
 *
 * The rules this task ships flag a customer's agent loop that has no step
 * ceiling. The dual failure on our side is a ceiling that exists but is
 * HAND-WRITTEN: #1025 raised the per-task token budget ×10 while the step cap
 * sat at a literal 32, so the extra allowance could not be spent and the
 * tasks changed from stopping on `budget` to stopping on `steps`. The cap
 * must be a finite positive integer AND must follow the budget it is derived
 * from — both are asserted here, the second as behaviour rather than as a
 * re-statement of the source line.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  HUNT_BATCH_WINDOW_CEILING_MS,
  HUNT_MAX_STEPS_PER_CATEGORY,
  HUNT_OBSERVED_STEP_TOKENS,
  HUNT_TRACE_MAX_STEPS,
  huntMaxStepsPerCategory,
  huntSpendableTokens,
} from '@/ee/security/services/security-hunt.config'

describe('LUM-794 hunt step cap invariant', () => {
  it('is a finite positive integer', () => {
    expect(Number.isFinite(HUNT_MAX_STEPS_PER_CATEGORY)).toBe(true)
    expect(Number.isInteger(HUNT_MAX_STEPS_PER_CATEGORY)).toBe(true)
    expect(HUNT_MAX_STEPS_PER_CATEGORY).toBeGreaterThan(0)
  })

  it('is the budget derivation, not a number that happens to sit beside it', () => {
    expect(HUNT_MAX_STEPS_PER_CATEGORY).toBe(
      huntMaxStepsPerCategory(huntSpendableTokens(), HUNT_OBSERVED_STEP_TOKENS)
    )
  })

  it('follows the budget: a wider window buys more steps, a dearer step buys fewer', () => {
    const spendable = huntSpendableTokens()
    const wider = huntSpendableTokens(HUNT_BATCH_WINDOW_CEILING_MS * 2)
    expect(wider).toBeGreaterThan(spendable)
    expect(
      huntMaxStepsPerCategory(wider, HUNT_OBSERVED_STEP_TOKENS)
    ).toBeGreaterThan(HUNT_MAX_STEPS_PER_CATEGORY)
    expect(
      huntMaxStepsPerCategory(spendable, HUNT_OBSERVED_STEP_TOKENS * 2)
    ).toBeLessThan(HUNT_MAX_STEPS_PER_CATEGORY)
    // Degenerate inputs stay finite integers rather than Infinity / NaN.
    expect(huntMaxStepsPerCategory(1, HUNT_OBSERVED_STEP_TOKENS)).toBe(1)
  })

  it('is not assigned a literal in the config source', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'ee/security/services/security-hunt.config.ts'),
      'utf8'
    )
    const assignment = source.match(
      /export const HUNT_MAX_STEPS_PER_CATEGORY =([^\n]*)/
    )
    expect(assignment).not.toBeNull()
    // `= 95` / `= 32` — the exact regression #1025 left behind for a release.
    expect(assignment![1]!.trim()).not.toMatch(/^[\d_]+$/)
    expect(assignment![1]!).toContain('huntMaxStepsPerCategory(')
  })

  it('keeps the audit able to hold every step the cap allows', () => {
    // The step cap and the per-step trace cap are the same number by
    // construction; a cap above the trace would run steps nothing can show.
    expect(HUNT_MAX_STEPS_PER_CATEGORY).toBeLessThanOrEqual(
      HUNT_TRACE_MAX_STEPS
    )
  })
})
