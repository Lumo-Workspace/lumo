import type {
  AcceptanceVerifier,
  VerificationHistoryRoundView,
} from '../../types'

type Verdict = VerificationHistoryRoundView['verdicts'][number]

/**
 * Split one round's verdicts into the primary verification verdicts
 * (MACHINE / HUMAN — the ones that define the round's result) and the AGENT
 * send-backs that piggybacked onto the same round number (a send-back reviews a
 * round, it does not create a new one — recordAgentVerdict round = max round).
 */
export function splitRoundVerdicts(round: VerificationHistoryRoundView): {
  primary: Verdict[]
  sendBacks: Verdict[]
} {
  const primary: Verdict[] = []
  const sendBacks: Verdict[] = []
  for (const v of round.verdicts) {
    if (v.verifierType === 'AGENT') sendBacks.push(v)
    else primary.push(v)
  }
  return { primary, sendBacks }
}

/** Display summary for a round's headline row, derived from its verdicts. */
export interface RoundHeadline {
  /** The single primary verifier when unambiguous (MACHINE/HUMAN), 'AGENT' for a
   *  send-back-only round, or null when primary verdicts mix types (→ generic). */
  verifier: AcceptanceVerifier | null
  /** Passing count over the verdicts the headline represents. */
  passed: number
  /** Total verdicts the headline represents. */
  total: number
  /** True when none of the represented verdicts is a FAIL (green badge). */
  tonePass: boolean
  /** True when the round has no MACHINE/HUMAN verdict — the row IS a send-back. */
  isSendBackOnly: boolean
  /** Number of AGENT send-back verdicts in this round (drives the sub-line). */
  sendBackCount: number
}

/**
 * Derive the headline for a round. The count reflects ONLY the primary
 * (MACHINE/HUMAN) verdicts, so a machine round that carries a send-back reads
 * 5/5 — not the misleading 5/7 — with the send-backs surfaced separately. A
 * round that is purely a send-back (recorded before any machine round) is its
 * own send-back headline.
 */
export function roundHeadline(
  round: VerificationHistoryRoundView
): RoundHeadline {
  const { primary, sendBacks } = splitRoundVerdicts(round)
  const sendBackCount = sendBacks.length

  if (primary.length === 0) {
    return {
      verifier: 'AGENT',
      passed: 0,
      total: sendBackCount,
      tonePass: false,
      isSendBackOnly: true,
      sendBackCount,
    }
  }

  const types = new Set(primary.map(v => v.verifierType))
  const verifier = types.size === 1 ? primary[0]!.verifierType : null
  const passed = primary.filter(v => v.verdict !== 'FAIL').length
  const total = primary.length
  return {
    verifier,
    passed,
    total,
    tonePass: passed === total,
    isSendBackOnly: false,
    sendBackCount,
  }
}
