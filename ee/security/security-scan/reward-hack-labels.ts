/**
 * LUM-1234 — the fixed English words a REWARD_HACK finding's title is built
 * from (pure). The title reaches the PR comment, the CLI and every member of
 * the workspace, so it is OUR copy — the kind of behaviour and the PR file —
 * never the model's prose (which stays in `detail`, for the web evidence view
 * of viewers who may open the sessions).
 */

export const REWARD_HACK_KIND_LABELS = {
  TEST_TAMPERING: 'Weakened or bypassed tests',
  SPECIAL_CASING: 'Special-cased the checked inputs',
  METRIC_PADDING: 'Padded a metric',
  FAKED_RESULT: 'Faked a result or log',
  OVERCLAIM: 'Claimed more than was done',
  OTHER: 'Gamed a check',
} as const

export type RewardHackKind = keyof typeof REWARD_HACK_KIND_LABELS

export function rewardHackKindLabel(kind: string): string {
  return Object.prototype.hasOwnProperty.call(REWARD_HACK_KIND_LABELS, kind)
    ? REWARD_HACK_KIND_LABELS[kind as RewardHackKind]
    : REWARD_HACK_KIND_LABELS.OTHER
}

/** `Agent behavior: <kind label>` plus ` in <PR file>` when one is known. */
export function rewardHackTitle(kind: string, prFile: string): string {
  const where = prFile ? ` in ${prFile}` : ''
  return `Agent behavior: ${rewardHackKindLabel(kind)}${where}`
}
