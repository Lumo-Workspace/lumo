import {
  HUNT_MAX_PLANNED_TASKS,
  HUNT_TASK_TOKEN_MAX,
  HUNT_TASK_TIME_MS,
  HUNT_TOKEN_BUDGET,
  HUNT_TIME_BUDGET_MS,
} from '@/lib/services/security-hunt.config'

// LUM-758 follow-up: the per-task ceiling is not a free-floating number — it is
// pinned on both sides. Raising it alone silently breaks either the acceptance
// target or the scan budget, and neither failure is visible until prod.
describe('hunt budget arithmetic', () => {
  const ACCEPTANCE_TARGET_MEAN_TOKENS = 60_000

  it('a full plan bills at most the acceptance target mean', () => {
    expect(HUNT_MAX_PLANNED_TASKS * HUNT_TASK_TOKEN_MAX).toBeLessThanOrEqual(
      ACCEPTANCE_TARGET_MEAN_TOKENS
    )
  })

  it('a full plan plus one retry each still fits the scan budget', () => {
    expect(
      HUNT_MAX_PLANNED_TASKS * HUNT_TASK_TOKEN_MAX * 2
    ).toBeLessThanOrEqual(HUNT_TOKEN_BUDGET)
    expect(HUNT_MAX_PLANNED_TASKS * HUNT_TASK_TIME_MS * 2).toBeLessThanOrEqual(
      HUNT_TIME_BUDGET_MS * 2
    )
  })

  it('a full plan fits the time budget without retries', () => {
    expect(HUNT_MAX_PLANNED_TASKS * HUNT_TASK_TIME_MS).toBeLessThanOrEqual(
      HUNT_TIME_BUDGET_MS
    )
  })
})
