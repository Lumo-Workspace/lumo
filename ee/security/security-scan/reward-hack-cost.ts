/**
 * LUM-1234 — what one reward-hack model call costs us, before and after it
 * runs (pure). The monthly ceiling is enforced by charging an estimate to the
 * ledger BEFORE every call and reconciling it to the reported cost after: a
 * call whose function is killed mid-flight, or whose gateway reports no cost,
 * still counts against the ceiling.
 *
 * Prices are the REWARD_HACK_MODEL's list prices (USD per million tokens);
 * update them with the model.
 */

export const RH_INPUT_USD_PER_MTOK = 3
export const RH_OUTPUT_USD_PER_MTOK = 15

/** Our cap on one call's estimated input tokens; over it nothing is sent. */
export const RH_MAX_INPUT_TOKENS = 180_000

/**
 * A deliberately high token estimate: ASCII text at 3 characters per token
 * (code and English run nearer 4), every other character a token of its own
 * (CJK and similar scripts are about one per character).
 */
export function estimateRhTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++
    else other++
  }
  return Math.ceil(ascii / 3) + other
}

export function rhTokensCostUsd(
  inputTokens: number,
  outputTokens: number
): number {
  return (
    (inputTokens * RH_INPUT_USD_PER_MTOK +
      outputTokens * RH_OUTPUT_USD_PER_MTOK) /
    1e6
  )
}

/** Upper estimate of one call: its whole input plus the most it may write. */
export function estimateRhCallUsd(
  input: string,
  maxOutputTokens: number
): number {
  return rhTokensCostUsd(estimateRhTokens(input), maxOutputTokens)
}

/**
 * The cost to book for a finished call: the gateway's reported cost; without
 * one, its token usage at list price; without usage either, the estimate
 * that was charged stays (never 0 — an unreported call is not free).
 */
export function settledRhCallUsd(
  reported: {
    costUsd: number | null
    inputTokens?: number
    outputTokens?: number
  },
  estimateUsd: number
): number {
  if (reported.costUsd !== null && Number.isFinite(reported.costUsd))
    return Math.max(0, reported.costUsd)
  const input = reported.inputTokens ?? 0
  const output = reported.outputTokens ?? 0
  if (input > 0 || output > 0) return rhTokensCostUsd(input, output)
  return estimateUsd
}
