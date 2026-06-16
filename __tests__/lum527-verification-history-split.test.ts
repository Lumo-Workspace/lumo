/**
 * LUM-527: 验证记录面板按 verifierType 拆行 — pure-helper unit tests.
 *
 * An agent send-back shares the latest round number (recordAgentVerdict uses
 * `round = Math.max(1, maxRound)` — a send-back reviews a round, it is not a new
 * one). So a round can mix MACHINE verdicts + AGENT send-back FAILs. The headline
 * must count ONLY the primary (MACHINE/HUMAN) verdicts so the badge reads 5/5
 * (not the misleading 5/7), with the send-backs peeled off into their own group.
 */
import {
  splitRoundVerdicts,
  roundHeadline,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/verification-history'
import type {
  VerificationHistoryRoundView,
  AcceptanceVerdict,
  AcceptanceVerifier,
} from '@/app/workspace/[workspaceUrl]/types'

let seq = 0
function verdict(
  verifierType: AcceptanceVerifier,
  verdict: AcceptanceVerdict
): VerificationHistoryRoundView['verdicts'][number] {
  return {
    criterionId: `c${seq++}`,
    verdict,
    verifierType,
    evidencePointer: null,
    rejectionReason: null,
    rejectionReasonEnum: null,
  }
}

function round(
  verdicts: VerificationHistoryRoundView['verdicts']
): VerificationHistoryRoundView {
  return {
    round: 1,
    recordedAt: '2026-06-15T07:17:00.000Z',
    passed: verdicts.filter(v => v.verdict !== 'FAIL').length,
    failed: verdicts.filter(v => v.verdict === 'FAIL').length,
    verdicts,
  }
}

describe('splitRoundVerdicts', () => {
  it('partitions AGENT send-backs out of the primary verdicts', () => {
    const r = round([
      verdict('MACHINE', 'PASS'),
      verdict('AGENT', 'FAIL'),
      verdict('HUMAN', 'PASS'),
    ])
    const { primary, sendBacks } = splitRoundVerdicts(r)
    expect(primary.map(v => v.verifierType)).toEqual(['MACHINE', 'HUMAN'])
    expect(sendBacks.map(v => v.verifierType)).toEqual(['AGENT'])
  })
})

describe('roundHeadline', () => {
  it('counts only primary verdicts when a machine round carries a send-back (LUM-522)', () => {
    const r = round([
      verdict('MACHINE', 'PASS'),
      verdict('MACHINE', 'PASS'),
      verdict('MACHINE', 'PASS'),
      verdict('MACHINE', 'PASS'),
      verdict('MACHINE', 'PASS'),
      verdict('AGENT', 'FAIL'),
      verdict('AGENT', 'FAIL'),
    ])
    expect(roundHeadline(r)).toEqual({
      verifier: 'MACHINE',
      passed: 5,
      total: 5,
      tonePass: true,
      isSendBackOnly: false,
      sendBackCount: 2,
    })
  })

  it('a clean machine round has no send-backs', () => {
    const r = round([verdict('MACHINE', 'PASS'), verdict('MACHINE', 'PASS')])
    expect(roundHeadline(r)).toMatchObject({
      verifier: 'MACHINE',
      passed: 2,
      total: 2,
      tonePass: true,
      sendBackCount: 0,
      isSendBackOnly: false,
    })
  })

  it('a primary FAIL makes the headline tone non-pass', () => {
    const r = round([verdict('MACHINE', 'PASS'), verdict('MACHINE', 'FAIL')])
    expect(roundHeadline(r)).toMatchObject({
      passed: 1,
      total: 2,
      tonePass: false,
    })
  })

  it('a send-back-only round (no machine verdicts yet) is the send-back itself', () => {
    const r = round([verdict('AGENT', 'FAIL'), verdict('AGENT', 'FAIL')])
    expect(roundHeadline(r)).toEqual({
      verifier: 'AGENT',
      passed: 0,
      total: 2,
      tonePass: false,
      isSendBackOnly: true,
      sendBackCount: 2,
    })
  })

  it('mixed MACHINE+HUMAN primary verdicts fall back to a null (generic) verifier', () => {
    const r = round([verdict('MACHINE', 'PASS'), verdict('HUMAN', 'PASS')])
    expect(roundHeadline(r)).toMatchObject({
      verifier: null,
      passed: 2,
      total: 2,
      tonePass: true,
    })
  })

  it('treats PASS_WITH_FOLLOWUP as a pass in the count', () => {
    const r = round([
      verdict('HUMAN', 'PASS_WITH_FOLLOWUP'),
      verdict('HUMAN', 'PASS'),
    ])
    expect(roundHeadline(r)).toMatchObject({
      passed: 2,
      total: 2,
      tonePass: true,
    })
  })
})
