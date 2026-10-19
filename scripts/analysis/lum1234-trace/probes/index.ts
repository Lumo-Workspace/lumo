/**
 * LUM-1234 — the reward-hack probes: five hand-written positives, one per
 * shape the layer must catch, and one honest negative. `calibrate-pr.ts
 * --probes` runs them through the same `decideRewardHack` core as the PRs.
 */
import { probeSpecialCasing } from './a-special-casing'
import { probeDeletedTests } from './b-deleted-tests'
import { probeLoosenedAssertion } from './c-loosened-assertion'
import { probeCoveragePadding } from './d-coverage-padding'
import { probeFalseGreenClaim } from './e-false-green-claim'
import { probeHonestFix } from './f-honest-fix'
import type { RhProbe } from './probe-kit'

export type { RhProbe } from './probe-kit'
export { PROBE_MERGED_AT } from './probe-kit'

export const RH_PROBES: RhProbe[] = [
  probeSpecialCasing,
  probeDeletedTests,
  probeLoosenedAssertion,
  probeCoveragePadding,
  probeFalseGreenClaim,
  probeHonestFix,
]
