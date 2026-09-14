import {
  HUNT_MAX_PLANNED_TASKS,
  HUNT_TASK_TOKEN_MAX,
  HUNT_TASK_TIME_MS,
  HUNT_TOKEN_BUDGET,
  HUNT_TIME_BUDGET_MS,
  PLAN_HUNT_TOKEN_BUDGET,
  PLAN_HUNT_TIMEOUT_MS,
  PLAN_HUNT_MAX_ATTEMPTS,
  PLAN_HUNT_OBSERVED_OUTPUT_MAX,
  PLAN_HUNT_OBSERVED_THROUGHPUT_P10_TPS,
  PLAN_HUNT_LATENCY_RESIDUAL_P99_MS,
  PLAN_OBJECTIVE_OBSERVED_MAX_CHARS,
  PLAN_OBJECTIVE_MAX_CHARS,
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

  // LUM-766: three plan-step numbers, each pinned to what was measured on 16
  // real prompts (real acceptance contracts + real PR file lists) through the
  // shipped planHuntTasks — 47 reasoning-on samples:
  //
  //   budget   — a cap on the reasoning tail. Output demand is heavy-tailed
  //              (the same prompt spent 1 938 then 3 912 reasoning tokens);
  //              observed max ≈ 5 400. Below that the tail comes back as
  //              finish=length → zero plan → deterministic fallback, no retry.
  //   objective cap — sent to the model as JSON-schema maxLength. Below the
  //              natural length (max 1 058 at cap 1 200) the reasoning model
  //              rewrites until the budget is gone (old 400: 0/16 parsed).
  //              Human ruling: ≥ 50 % headroom, and the length stretches a
  //              little with the cap, so the headroom is measured against
  //              the observed max, not the median.
  //   window   — must cover at least p99.9 latency (human ruling). Tens of
  //              samples cannot estimate p99.9; the analytic bound can: the
  //              budget caps the output, so latency ≤ budget ÷ slowest
  //              throughput + fixed overhead. That is p100 given the budget.
  //              Throughput is the sample p10 (79 tok/s → 75), overhead the
  //              regression residual p99 (≈ 7 s). The old 20 s sat at the
  //              healthy median and aborted half of all attempts.
  it('LUM-766: the output budget clears the observed output demand with headroom', () => {
    expect(PLAN_HUNT_TOKEN_BUDGET).toBeGreaterThanOrEqual(
      PLAN_HUNT_OBSERVED_OUTPUT_MAX * 1.25
    )
  })

  it('LUM-766: the objective cap leaves at least 50% over the longest objective the model wrote', () => {
    expect(PLAN_OBJECTIVE_MAX_CHARS).toBeGreaterThanOrEqual(
      PLAN_OBJECTIVE_OBSERVED_MAX_CHARS * 1.5
    )
  })

  it('LUM-766: the plan window covers the whole output budget at the slowest observed throughput', () => {
    const boundMs =
      (PLAN_HUNT_TOKEN_BUDGET / PLAN_HUNT_OBSERVED_THROUGHPUT_P10_TPS) * 1000 +
      PLAN_HUNT_LATENCY_RESIDUAL_P99_MS
    expect(PLAN_HUNT_TIMEOUT_MS).toBeGreaterThanOrEqual(boundMs)
  })

  // Planning is its own step, but it must never out-wait the hunt it is
  // planning for: all attempts together stay within the hunt's own time budget.
  it('LUM-766: every planning attempt together stays within the hunt time budget', () => {
    expect(PLAN_HUNT_TIMEOUT_MS * PLAN_HUNT_MAX_ATTEMPTS).toBeLessThanOrEqual(
      HUNT_TIME_BUDGET_MS
    )
  })
})
