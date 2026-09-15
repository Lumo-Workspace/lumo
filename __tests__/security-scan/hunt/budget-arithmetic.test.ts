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
  PLAN_REASON_OBSERVED_MAX_CHARS,
  PLAN_REASON_MAX_CHARS,
} from '@/lib/services/security-hunt.config'

// LUM-758 follow-up: the per-task ceiling is not a free-floating number — it is
// pinned on both sides. Raising it alone silently breaks either the acceptance
// target or the scan budget, and neither failure is visible until prod.
describe('hunt budget arithmetic', () => {
  // LUM-787 follow-up: 60k → 90k with the per-task ceiling (see HUNT_TASK_TOKEN_MAX).
  const ACCEPTANCE_TARGET_MEAN_TOKENS = 90_000

  // LUM-787 follow-up: the per-task number is a band (MIN / MEAN / MAX) and
  // the allocator splits `cap × MEAN`; what the pins guard is the split's
  // sum, not a flat product.
  it('a full plan bills at most the acceptance target mean, however the sites fall', () => {
    expect(HUNT_MAX_PLANNED_TASKS * HUNT_TASK_TOKEN_MEAN).toBeLessThanOrEqual(
      ACCEPTANCE_TARGET_MEAN_TOKENS
    )
    const tasks = ['injection', 'ssrf', 'idor'].map((c, i) => ({
      id: `t${i + 1}`,
      category: c as 'injection',
      startingPoints: [],
    }))
    for (const sites of [
      [],
      [{ rule: 'sink:prisma-raw', path: 'a.ts', line: 1 }],
      Array.from({ length: 40 }, (_, i) => ({
        rule: 'sink:fetch',
        path: `f${i}.ts`,
        line: 1,
      })),
    ]) {
      const out = allocateTaskBudgets(tasks, sites, HUNT_MAX_PLANNED_TASKS)
      const sum = [...out.values()].reduce((n, a) => n + a.tokenBudget, 0)
      expect(sum).toBeLessThanOrEqual(ACCEPTANCE_TARGET_MEAN_TOKENS)
    }
  })

  it('a full plan plus one retry each still fits the scan budget, at every tier', () => {
    for (const cap of [3, 4, 5]) {
      expect(cap * HUNT_TASK_TOKEN_MEAN * 2).toBeLessThanOrEqual(
        huntTokenBudget(cap)
      )
      expect(cap * HUNT_TASK_TIME_MS + HUNT_TASK_TIME_MS).toBeLessThanOrEqual(
        huntTimeBudgetMs(cap)
      )
    }
    expect(HUNT_TOKEN_BUDGET).toBe(huntTokenBudget(HUNT_MAX_PLANNED_TASKS))
    expect(HUNT_TIME_BUDGET_MS).toBe(huntTimeBudgetMs(HUNT_MAX_PLANNED_TASKS))
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

  // LUM-776: same trap as the objective, one level up. The plan's `reason`
  // cap is sent as JSON-schema maxLength; production `plannedBy=model` rows
  // wrote reasons up to 462 chars against a cap of 400.
  it('LUM-776: the reason cap leaves at least 50% over the longest reason the model wrote', () => {
    expect(PLAN_REASON_MAX_CHARS).toBeGreaterThanOrEqual(
      PLAN_REASON_OBSERVED_MAX_CHARS * 1.5
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

// LUM-787 — the arithmetic of a tool loop that re-sends its transcript, on
// the shipped constants. The stop predicate charges every step at what the
// transcript costs to re-send, so how many steps a 20k allowance buys is
// decided by how fast the transcript grows — and PR 1008's scan showed what
// unbounded growth buys: 6–8 parallel commands at up to 8k characters each,
// ~9k tokens added in one step, three of three tasks stopped at step 2 with
// no wrap-up. The simulation below walks the SAME predicate
// (`nextStepTokens`, the reserve, the wrap-up gate) over the observed shape
// of a step, so the per-step ceiling and the elision constants are judged
// against the physics production runs on, not against a hope.
import { allocateTaskBudgets } from '@/lib/security-scan/hunt/allocation'
import {
  HUNT_ELIDE_KEEP_STEPS,
  HUNT_TASK_TOKEN_MEAN,
  HUNT_TASK_TOKEN_MIN,
  huntTimeBudgetMs,
  huntTokenBudget,
  HUNT_OBSERVED_PROMPT_TOKENS,
  HUNT_OBSERVED_RESULT_CHARS_PER_TOKEN,
  HUNT_OBSERVED_STEP_OUTPUT_TOKENS,
  HUNT_OBSERVED_STEP_TEXT_TOKENS,
  HUNT_SHELL_OUTPUT_MAX,
  HUNT_STEP_OUTPUT_MAX,
  HUNT_WRAP_UP_MIN_TOKENS,
} from '@/lib/services/security-hunt.config'
import {
  lastStepTokens,
  nextStepTokens,
  sumTokens,
} from '@/lib/security-scan/hunt/budget'
import { elisionStub } from '@/lib/security-scan/hunt/transcript'

/**
 * Commands per step in the simulation. The prompt asks for one or two; prod
 * fired six to eight. Four is the pessimistic middle: it decides how many
 * elision stubs an old step leaves behind, which is the one cost elision
 * does not remove.
 */
const SIM_COMMANDS_PER_STEP = 4
const SIM_MAX_STEPS = 12

/**
 * One simulated search. Step k is sent the prompt, the assistant text of
 * every earlier step, and every earlier step's results — whole, or (with
 * elision) whole for the latest HUNT_ELIDE_KEEP_STEPS and a stub for the
 * rest. Its bill is that input plus the observed per-step output. After each
 * step the shipped predicate decides whether the next one runs.
 */
function simulateSearch(opts: {
  resultCharsPerStep: number
  elide: boolean
  budget: number
}) {
  const perToken = HUNT_OBSERVED_RESULT_CHARS_PER_TOKEN
  const resultTokens = Math.ceil(opts.resultCharsPerStep / perToken)
  const stubTokens = Math.ceil(
    (SIM_COMMANDS_PER_STEP *
      elisionStub(Math.ceil(opts.resultCharsPerStep / SIM_COMMANDS_PER_STEP))
        .length) /
      perToken
  )
  const steps: Array<{ usage: { totalTokens: number } }> = []
  for (let k = 1; k <= SIM_MAX_STEPS; k++) {
    const prior = k - 1
    let input =
      HUNT_OBSERVED_PROMPT_TOKENS + prior * HUNT_OBSERVED_STEP_TEXT_TOKENS
    if (opts.elide) {
      const whole = Math.min(prior, HUNT_ELIDE_KEEP_STEPS)
      input += whole * resultTokens + (prior - whole) * stubTokens
    } else {
      input += prior * resultTokens
    }
    steps.push({
      usage: { totalTokens: input + HUNT_OBSERVED_STEP_OUTPUT_TOKENS },
    })
    // The client's predicate, verbatim in shape: next step at
    // `nextStepTokens` (the pricier of the last two), the replay reserved at
    // the same price (floored), and no reserve for a price the allowance
    // could never cover.
    const price = Math.max(nextStepTokens(steps), HUNT_WRAP_UP_MIN_TOKENS)
    const reserve = price <= opts.budget ? price : 0
    if (sumTokens(steps) + nextStepTokens(steps) + reserve >= opts.budget) {
      break
    }
  }
  const spent = sumTokens(steps)
  const replay = Math.max(lastStepTokens(steps), HUNT_WRAP_UP_MIN_TOKENS)
  return {
    steps: steps.length,
    spent,
    wrapUpAffordable: opts.budget - spent >= replay,
  }
}

describe('LUM-787 step ceiling × elision × predictive stop', () => {
  it('the simulation reproduces PR 1008: one unbounded step of 25.6k characters ends the search at step 2, wrap-up unaffordable', () => {
    // t2's first step: six commands, 25 639 characters, `stop.steps: 2`,
    // `wrapUp.skipped: no-budget`. If the model of a step cannot reproduce
    // the failure it was built from, its verdict on the fix means nothing.
    // 20k literally: the row being reproduced ran under the ceiling of its
    // day, not under whatever the constant is now.
    const prod = simulateSearch({
      resultCharsPerStep: 25_639,
      elide: false,
      budget: 20_000,
    })
    expect(prod.steps).toBe(2)
    expect(prod.wrapUpAffordable).toBe(false)
  })

  it('with the per-step ceiling and elision a task completes at least four steps AND can still afford its wrap-up', () => {
    // At the FLOOR — the allowance every task is guaranteed.
    const fixed = simulateSearch({
      resultCharsPerStep: HUNT_STEP_OUTPUT_MAX,
      elide: true,
      budget: HUNT_TASK_TOKEN_MIN,
    })
    expect(fixed.steps).toBeGreaterThanOrEqual(4)
    expect(fixed.wrapUpAffordable).toBe(true)
    // Neither half is optional: at this ceiling WITHOUT elision the third
    // step already carries two steps' worth of results and the search stops
    // at three. Both constants are tuned together, against this test.
  })

  it('LUM-787 follow-up: the per-task band and the scan budget moved together, and the wrap-up floor did not', () => {
    // The flat 20k became a band on the user's call after the first six
    // production tasks on the bounded loop ended `budget` three times at
    // 4–5 steps: 20k floor / 30k mean / 45k ceiling, split by sites; the
    // scan budget is twice pass 1 (180k at the smallest tier) so every task
    // can be retried. The 4k wrap-up floor stays: production wrap-ups bill
    // 3.4–4.1k.
    expect(HUNT_TASK_TOKEN_MIN).toBe(20_000)
    expect(HUNT_TASK_TOKEN_MEAN).toBe(30_000)
    expect(HUNT_TASK_TOKEN_MAX).toBe(45_000)
    expect(HUNT_TOKEN_BUDGET).toBe(180_000)
    expect(HUNT_WRAP_UP_MIN_TOKENS).toBe(4_000)
  })

  it('LUM-787 follow-up: at the mean the simulated search completes at least six steps, at the ceiling at least eight, with the wrap-up affordable', () => {
    const mean = simulateSearch({
      resultCharsPerStep: HUNT_STEP_OUTPUT_MAX,
      elide: true,
      budget: HUNT_TASK_TOKEN_MEAN,
    })
    expect(mean.steps).toBeGreaterThanOrEqual(6)
    expect(mean.wrapUpAffordable).toBe(true)
    const ceiling = simulateSearch({
      resultCharsPerStep: HUNT_STEP_OUTPUT_MAX,
      elide: true,
      budget: HUNT_TASK_TOKEN_MAX,
    })
    // The per-step cost still creeps (assistant text + stubs), so the
    // ceiling buys eight, not eleven.
    expect(ceiling.steps).toBeGreaterThanOrEqual(8)
    expect(ceiling.wrapUpAffordable).toBe(true)
  })

  it('the step ceiling sits under the per-command cap, so the compressor still sees a whole command', () => {
    expect(HUNT_STEP_OUTPUT_MAX).toBeLessThanOrEqual(HUNT_SHELL_OUTPUT_MAX)
    expect(HUNT_STEP_OUTPUT_MAX).toBeGreaterThan(0)
  })
})
