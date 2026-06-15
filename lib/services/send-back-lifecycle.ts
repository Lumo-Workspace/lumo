export interface SendBackResolution {
  status: 'open' | 'resolved'
  failedAtRound: number
  resolvedAtRound?: number
  closingPrNumber?: number
  closingPrUrl?: string
}

interface RunLike {
  criterionId: string
  round: number
  verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
  verifierType: 'HUMAN' | 'AGENT' | 'MACHINE'
  createdAt: Date
}

interface PrLike {
  number: number
  url: string
  createdAt: Date
}

const isPass = (v: RunLike['verdict']): boolean =>
  v === 'PASS' || v === 'PASS_WITH_FOLLOWUP'

/**
 * Per-criterion send-back lifecycle from the run history. A send-back is a
 * HUMAN/AGENT FAIL (a MACHINE verify-loop FAIL is not a 打回). Resolved iff the
 * latest verdict is now PASS; open iff still FAIL. Returns null when the
 * criterion was never sent back. Best-effort closing PR = the earliest PR
 * created in the [last send-back → resolving PASS] window. Pure — no I/O.
 */
export function deriveSendBackResolution(
  criterionId: string,
  allRuns: RunLike[],
  prs: PrLike[]
): SendBackResolution | null {
  const runs = allRuns
    .filter(r => r.criterionId === criterionId)
    .sort(
      (a, b) =>
        a.round - b.round || a.createdAt.getTime() - b.createdAt.getTime()
    )
  if (runs.length === 0) return null
  const sendBacks = runs.filter(
    r => r.verdict === 'FAIL' && r.verifierType !== 'MACHINE'
  )
  if (sendBacks.length === 0) return null

  const latest = runs[runs.length - 1]!
  const lastSendBack = sendBacks[sendBacks.length - 1]!

  if (!isPass(latest.verdict)) {
    return { status: 'open', failedAtRound: lastSendBack.round }
  }

  // Resolved: the first PASS at/after the last send-back closes it.
  const resolving = runs.find(
    r =>
      isPass(r.verdict) &&
      r.createdAt.getTime() >= lastSendBack.createdAt.getTime()
  )!
  const pr = prs
    .filter(
      p =>
        p.createdAt.getTime() >= lastSendBack.createdAt.getTime() &&
        p.createdAt.getTime() <= resolving.createdAt.getTime()
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]

  return {
    status: 'resolved',
    failedAtRound: lastSendBack.round,
    resolvedAtRound: resolving.round,
    ...(pr ? { closingPrNumber: pr.number, closingPrUrl: pr.url } : {}),
  }
}
