/**
 * LUM-787 — the token arithmetic of the hunt's tool loop, as pure functions.
 *
 * The predictive stop in `lib/llm/security-hunt-client.ts` runs on these;
 * `__tests__/security-scan/hunt/budget-arithmetic.test.ts` walks a simulated
 * search on the same functions and the shipped constants, so the constants
 * are judged against the arithmetic production runs. They live here rather
 * than in the client because the client statically imports `ai`, which the
 * arithmetic test must not (jest TransformStream trap).
 */

export type UsageSteps = ReadonlyArray<{
  usage?: { totalTokens?: number | undefined } | undefined
}>

/**
 * The most recent step's cost. `.at(-1)` is deliberately avoided — this
 * repo's TS target predates it (LUM-732).
 */
export function lastStepTokens(steps: UsageSteps): number {
  if (steps.length === 0) return 0
  return steps[steps.length - 1]?.usage?.totalTokens ?? 0
}

export function sumTokens(steps: UsageSteps): number {
  let total = 0
  for (const s of steps) total += s.usage?.totalTokens ?? 0
  return total
}

/**
 * The price of the step we have NOT run yet: the pricier of the last two
 * steps. `lastStep` alone is a floor, not an estimate — in prod (PR 1008)
 * the difference was the wrap-up: a search passed the predicate holding
 * exactly `lastStep` for the next step and `lastStep` for the replay, the
 * next step then cost more, and the replay it had been "reserving" for was
 * refused for want of the difference.
 *
 * Two steps of memory, and no extrapolated growth, on purpose. With older
 * results elided from the transcript (`transcript.ts`) the cost of a step
 * no longer trends up — it OSCILLATES: a step after a big result is dear, the
 * step after that (the big result now a stub) is cheap again. Extrapolating
 * `last − prev` on that shape over-prices every step that follows a dear
 * one by the whole swing (~1.9k on PR 1008's replay) and costs the search a
 * step it could afford; taking the pricier of the two is what the swing
 * actually bounds. With one step there is nothing to compare, and the price
 * is the last step, as before.
 */
export function nextStepTokens(steps: UsageSteps): number {
  const last = lastStepTokens(steps)
  if (steps.length < 2) return last
  const prev = steps[steps.length - 2]?.usage?.totalTokens ?? 0
  return Math.max(last, prev)
}

/** The most expensive step so far — the conservative price for a forecast. */
export function maxStepTokens(steps: UsageSteps): number {
  let max = 0
  for (const s of steps) max = Math.max(max, s.usage?.totalTokens ?? 0)
  return max
}

/**
 * LUM-787 — how many more search steps the allowance fits, as told to the
 * model. Deliberately MORE conservative than the stop predicate: every
 * future step is priced at the dearest step so far, and the replay reserve
 * at the same (floored) price. The predicate decides when to stop; this
 * decides when the model is told "this is your last step" — and being told
 * one step early costs a step, while being told one step late costs the
 * whole search (a wrap-up under duress instead of the model's own
 * submission). Never below 1: the step this is computed for is already
 * running.
 */
export function stepsLeftForecast(
  steps: UsageSteps,
  budget: number,
  reserveFloor: number
): number {
  const price = Math.max(1, maxStepTokens(steps))
  const reserve = Math.max(price, reserveFloor)
  const room = budget - sumTokens(steps) - reserve
  return Math.max(1, Math.floor(room / price))
}
