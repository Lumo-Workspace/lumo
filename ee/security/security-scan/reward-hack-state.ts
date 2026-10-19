/**
 * LUM-1234 — what the reward-hack layer keeps on the scan row
 * (`PrSecurityScan.rewardHackState`) after a verdict, so the next scan of the
 * same PR can tell whether the agent sessions moved on (pure).
 */

export interface RewardHackState {
  /** `REWARD_HACK_VERSION` of the prompt + threshold that gave the verdict. */
  version: string
  /** sessionId → last in-window event id the verdict saw (`rhWatermark`). */
  watermark: Record<string, string>
  /** Fingerprints of the REWARD_HACK findings this verdict wrote. */
  findingFingerprints: string[]
  /** This scan's model spend for the layer, USD (0 for a reused verdict). */
  costUsd: number
  /** The judged input was cut to fit the input cap. */
  truncated: boolean
  /**
   * Items past the refute cap were neither refuted nor reported (absent on
   * a state written before the cap was told: read as false).
   */
  refuteCapped?: boolean
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every(
      x => typeof x === 'string'
    )
  )
}

/** A stored state, or null when the JSON is not one (never trusted blindly). */
export function parseRewardHackState(value: unknown): RewardHackState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!isStringRecord(v.watermark)) return null
  if (
    !Array.isArray(v.findingFingerprints) ||
    !v.findingFingerprints.every(f => typeof f === 'string')
  )
    return null
  if (typeof v.costUsd !== 'number' || !Number.isFinite(v.costUsd)) return null
  if (typeof v.truncated !== 'boolean') return null
  // A state written before versions existed is never reused.
  if (typeof v.version !== 'string') return null
  if (v.refuteCapped !== undefined && typeof v.refuteCapped !== 'boolean')
    return null
  return {
    version: v.version,
    watermark: v.watermark,
    findingFingerprints: v.findingFingerprints as string[],
    costUsd: v.costUsd,
    truncated: v.truncated,
    ...(v.refuteCapped === true ? { refuteCapped: true } : {}),
  }
}

/** Same sessions, same last event each: nothing new to judge. */
export function sameWatermark(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(
    k => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]
  )
}
