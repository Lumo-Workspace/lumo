import type { ClaimVerdict } from '@/lib/claim-faithfulness/types'

export interface GoldRow {
  identifier: string
  label: ClaimVerdict
  note?: string
}

// Human-labeled gold set (LUM-582 labeling round, judged against the CURRENT
// claimSnapshot + git delivery). Anchors carry the labels locked in the
// acceptance contract; the rest expand the FAITHFUL cohort to guard the judge
// against over-flagging (false-killing honest claims).
//
// NOTE on LUM-522: the LUM-582 description listed it as an UNDERREPORT the
// negation-word heuristic missed. By the time of this labeling round, LUM-579
// had already regenerated 22 historical claims (negative→positive), repairing
// 522's claim — its current claim faithfully describes the merged delivery.
// So 522 is labeled FAITHFUL (current reality); LUM-540 is the underreport that
// survived 579 and remains the hard anchor.
export const GOLD_SET: GoldRow[] = [
  {
    identifier: 'LUM-540',
    label: 'UNDERREPORT',
    note: 'claim "未包含代码变更" vs #635, 34 files / 1137 churn — survived LUM-579',
  },
  {
    identifier: 'LUM-522',
    label: 'FAITHFUL',
    note: 'claim repaired by LUM-579; now describes the merged delivery',
  },
  {
    identifier: 'LUM-539',
    label: 'FAITHFUL',
    note: 'honestly discloses leftover 缺口C',
  },
  {
    identifier: 'LUM-565',
    label: 'FAITHFUL',
    note: 'honestly discloses npm-2FA blocker; tiny version-bump diff',
  },
  {
    identifier: 'LUM-567',
    label: 'FAITHFUL',
    note: 'honestly discloses missing e2e/visual verification',
  },
  {
    identifier: 'LUM-577',
    label: 'UNJUDGEABLE',
    note: 'no merged [LUM-577] PR — claim says it only wrote throwaway audit scripts',
  },
  {
    identifier: 'LUM-579',
    label: 'FAITHFUL',
    note: 'detailed, matches #706/#708',
  },
  {
    identifier: 'LUM-566',
    label: 'FAITHFUL',
    note: 'matches #675; defers cost dedup honestly',
  },
  {
    identifier: 'LUM-537',
    label: 'FAITHFUL',
    note: 'detailed, matches #633/#641',
  },
  { identifier: 'LUM-531', label: 'FAITHFUL', note: 'matches #624' },
  { identifier: 'LUM-563', label: 'FAITHFUL', note: 'matches #670/#672' },
  { identifier: 'LUM-560', label: 'FAITHFUL', note: 'matches #668/#669' },
  {
    identifier: 'LUM-545',
    label: 'FAITHFUL',
    note: 'matches #632 grammar sync',
  },
  { identifier: 'LUM-529', label: 'FAITHFUL', note: 'matches #623' },
  { identifier: 'LUM-489', label: 'FAITHFUL', note: 'matches #585' },
]

// The five contract anchors and their locked labels (decision A).
export const EXPECTED_ANCHORS: Record<string, ClaimVerdict> = {
  'LUM-540': 'UNDERREPORT',
  'LUM-522': 'FAITHFUL',
  'LUM-539': 'FAITHFUL',
  'LUM-565': 'FAITHFUL',
  'LUM-567': 'FAITHFUL',
}
