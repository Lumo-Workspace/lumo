/**
 * @jest-environment node
 *
 * LUM-769 — the read receipts are stateless, server-signed proofs that the
 * handshake steps ran for THIS crossing, THIS ruling, THIS caller, against
 * the crossing's CURRENT state: stage 1 (envelope shown) → stage 2 (read
 * acknowledged) → write, which accepts stage 2 only. Anything else fails.
 */
import {
  acknowledgeReadReceipt,
  crossingStateHash,
  issueReadReceipt,
  readReceiptSecret,
  receiptStageOf,
  verifyReadReceipt,
  READ_RECEIPT_TTL_MS,
  type ReceiptCrossingState,
  type ReceiptSubject,
} from '@/lib/boundary-crossing/read-receipt'

const SECRET = 'test-secret'
const T0 = new Date('2026-09-14T10:00:00.000Z')
const T1 = new Date('2026-09-14T10:01:00.000Z')
const T2 = new Date('2026-09-14T10:02:00.000Z')

const state: ReceiptCrossingState = {
  disposition: null,
  occurrenceCount: 2,
  lastSeenAt: '2026-09-14T09:00:00.000Z',
  detectedAt: '2026-09-14T08:00:00.000Z',
  severity: 'MEDIUM',
  category: 'TEST_FILE_DELETED',
  detail: 'deleted __tests__/x.test.ts',
  explanationIds: ['ex-1', 'ex-2'],
}

const subject: ReceiptSubject = {
  crossingId: 'cx-1',
  taskId: 't-1',
  target: 'FALSE_POSITIVE',
  sessionId: 'sess-1',
  memberId: 'm-1',
  stateHash: crossingStateHash(state),
}

function ack(now = T1) {
  const r1 = issueReadReceipt(SECRET, subject, T0)
  const out = acknowledgeReadReceipt(SECRET, r1.receipt, subject, now)
  if (!out.ok) throw new Error(`ack failed: ${out.reason}`)
  return { r1, r2: out.issued }
}

describe('read receipt (LUM-769)', () => {
  it('receipt stage 1 round-trips for the same subject and state, within its TTL', () => {
    const r1 = issueReadReceipt(SECRET, subject, T0)
    expect(r1.receipt).toMatch(/^r1\.\d+\.\d+\.[A-Za-z0-9_-]+$/)
    expect(r1.stage).toBe('READ')
    expect(r1.readAt).toBe(T0.toISOString())
    expect(r1.readAcknowledgedAt).toBeNull()
    expect(r1.expiresAt).toBe(
      new Date(T0.getTime() + READ_RECEIPT_TTL_MS).toISOString()
    )
    expect(verifyReadReceipt(SECRET, r1.receipt, subject, T1)).toEqual({
      ok: true,
      stage: 'READ',
      readAt: T0.toISOString(),
      readAcknowledgedAt: null,
    })
    expect(receiptStageOf(r1.receipt)).toBe('READ')
  })

  it('receipt stage 2 is issued only from a valid stage-1 receipt and carries the read time forward', () => {
    const { r1, r2 } = ack()
    expect(r2.receipt).toMatch(/^r2\.\d+\.\d+\.\d+\.[A-Za-z0-9_-]+$/)
    expect(r2.stage).toBe('ACK')
    expect(r2.readAt).toBe(T0.toISOString())
    expect(r2.readAcknowledgedAt).toBe(T1.toISOString())
    expect(receiptStageOf(r2.receipt)).toBe('ACK')
    expect(
      verifyReadReceipt(SECRET, r2.receipt, subject, T2, {
        requireStage: 'ACK',
      })
    ).toEqual({
      ok: true,
      stage: 'ACK',
      readAt: T0.toISOString(),
      readAcknowledgedAt: T1.toISOString(),
    })
    // Acknowledging twice, or acknowledging a forged/foreign token, is refused.
    expect(acknowledgeReadReceipt(SECRET, r2.receipt, subject, T2)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    expect(
      acknowledgeReadReceipt(
        SECRET,
        r1.receipt,
        { ...subject, target: 'CONFIRMED' },
        T1
      )
    ).toEqual({ ok: false, reason: 'mismatch' })
    expect(acknowledgeReadReceipt(SECRET, 'nope', subject, T1)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('receipt: confirming with a stage-1 token is refused as not_acknowledged — read must be confirmed first', () => {
    const r1 = issueReadReceipt(SECRET, subject, T0)
    expect(
      verifyReadReceipt(SECRET, r1.receipt, subject, T1, {
        requireStage: 'ACK',
      })
    ).toEqual({ ok: false, reason: 'not_acknowledged' })
    // …and it stays a plain valid stage-1 token without the requirement.
    expect(verifyReadReceipt(SECRET, r1.receipt, subject, T1).ok).toBe(true)
  })

  const drifts: Array<[string, Partial<ReceiptSubject>]> = [
    ['another crossing', { crossingId: 'cx-2' }],
    ['another task', { taskId: 't-2' }],
    ['the other ruling', { target: 'CONFIRMED' }],
    ['another session', { sessionId: 'sess-2' }],
    ['an unbound caller', { sessionId: null }],
    ['another member', { memberId: 'm-2' }],
  ]
  it.each(drifts)(
    'receipt (both stages) is rejected as mismatch when used for %s',
    (_label, drift) => {
      const { r1, r2 } = ack()
      const other = { ...subject, ...drift }
      expect(verifyReadReceipt(SECRET, r1.receipt, other, T1)).toEqual({
        ok: false,
        reason: 'mismatch',
      })
      expect(
        verifyReadReceipt(SECRET, r2.receipt, other, T2, {
          requireStage: 'ACK',
        })
      ).toEqual({ ok: false, reason: 'mismatch' })
    }
  )

  it('receipt (both stages) is voided by any change to the crossing state it was read against', () => {
    const { r1, r2 } = ack()
    const changes: Array<Partial<ReceiptCrossingState>> = [
      { disposition: 'CONFIRMED' },
      { occurrenceCount: 3, lastSeenAt: '2026-09-14T09:30:00.000Z' },
      { explanationIds: ['ex-1', 'ex-2', 'ex-3'] },
      { detail: 'deleted __tests__/y.test.ts' },
      { severity: 'HIGH' },
    ]
    for (const d of changes) {
      const changed = {
        ...subject,
        stateHash: crossingStateHash({ ...state, ...d }),
      }
      expect(verifyReadReceipt(SECRET, r1.receipt, changed, T1)).toEqual({
        ok: false,
        reason: 'mismatch',
      })
      expect(
        verifyReadReceipt(SECRET, r2.receipt, changed, T2, {
          requireStage: 'ACK',
        })
      ).toEqual({ ok: false, reason: 'mismatch' })
      expect(acknowledgeReadReceipt(SECRET, r1.receipt, changed, T1)).toEqual({
        ok: false,
        reason: 'mismatch',
      })
    }
    // The hash itself is deterministic and independent of Date vs string.
    expect(
      crossingStateHash({
        ...state,
        lastSeenAt: new Date(state.lastSeenAt as string),
      })
    ).toBe(subject.stateHash)
  })

  it('receipt is rejected when expired, forged, signed with another secret, or malformed', () => {
    const { r1, r2 } = ack()
    const late = new Date(T1.getTime() + READ_RECEIPT_TTL_MS + 1)
    expect(verifyReadReceipt(SECRET, r1.receipt, subject, late)).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(
      verifyReadReceipt(SECRET, r2.receipt, subject, late, {
        requireStage: 'ACK',
      })
    ).toEqual({ ok: false, reason: 'expired' })
    expect(verifyReadReceipt('other', r1.receipt, subject, T1)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    const [v, iat, exp, sig] = r1.receipt.split('.')
    expect(
      verifyReadReceipt(SECRET, `${v}.${iat}.${exp}.AAAA`, subject, T1)
    ).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    // Stretching the expiry breaks the signature — exp is inside the message.
    expect(
      verifyReadReceipt(
        SECRET,
        `${v}.${iat}.${Number(exp) + 60_000}.${sig}`,
        subject,
        T1
      )
    ).toEqual({ ok: false, reason: 'mismatch' })
    // Relabelling a stage-1 token as stage 2 breaks the signature too.
    expect(
      verifyReadReceipt(SECRET, `r2.${iat}.${iat}.${exp}.${sig}`, subject, T1, {
        requireStage: 'ACK',
      })
    ).toEqual({ ok: false, reason: 'mismatch' })
    for (const bad of [
      '',
      'r1',
      'r0.1.2.sig',
      'r1.x.y.sig',
      'r1.1.2.',
      'r2.1.2.sig',
      'r1.1.2.3.sig',
    ]) {
      expect(verifyReadReceipt(SECRET, bad, subject, T1)).toEqual({
        ok: false,
        reason: 'malformed',
      })
    }
    expect(receiptStageOf('r0.1.2.sig')).toBeNull()
  })

  it('receipt secret: LUMO_RECEIPT_SECRET wins, CRON_SECRET is the fallback, nothing configured is null (fail closed)', () => {
    expect(
      readReceiptSecret({ LUMO_RECEIPT_SECRET: 'a', CRON_SECRET: 'b' })
    ).toBe('a')
    expect(readReceiptSecret({ CRON_SECRET: 'b' })).toBe('b')
    expect(
      readReceiptSecret({ LUMO_RECEIPT_SECRET: '', CRON_SECRET: '' })
    ).toBeNull()
    expect(readReceiptSecret({})).toBeNull()
  })
})

// ─── LUM-750: finding subjects ───────────────────────────────────────────────

import {
  findingStateHash,
  findingsSetStateHash,
  describeReceiptFailure,
  type ReceiptFindingState,
} from '@/lib/boundary-crossing/read-receipt'

const findingState: ReceiptFindingState = {
  disposition: null,
  severity: 'HIGH',
  provenance: 'EXTERNAL_TOOL',
  fingerprint: 'fp-1',
  ruleId: 'ext:semgrep:sqli',
  suggestedDisposition: 'FALSE_POSITIVE',
}

const findingSubject: ReceiptSubject = {
  kind: 'finding',
  crossingId: 'f-1',
  taskId: 't-1',
  target: 'ACCEPTED_RISK',
  sessionId: null,
  memberId: 'm-1',
  stateHash: findingStateHash(findingState),
}

describe('read receipt — finding subjects (LUM-750)', () => {
  it('round-trips the three stages for a finding, bound to the finding state (disposition / severity / provenance / fingerprint / ruleId / suggestion)', () => {
    const r1 = issueReadReceipt(SECRET, findingSubject, T0)
    const ack = acknowledgeReadReceipt(SECRET, r1.receipt, findingSubject, T1)
    if (!ack.ok) throw new Error(ack.reason)
    expect(
      verifyReadReceipt(SECRET, ack.issued.receipt, findingSubject, T2, {
        requireStage: 'ACK',
      })
    ).toMatchObject({ ok: true, stage: 'ACK' })
    // A stage-1 receipt at the write step is "not acknowledged".
    expect(
      verifyReadReceipt(SECRET, r1.receipt, findingSubject, T1, {
        requireStage: 'ACK',
      })
    ).toEqual({ ok: false, reason: 'not_acknowledged' })
    // Every bound field voids the receipt when it drifts.
    const drifts: Array<[string, ReceiptFindingState]> = [
      ['disposition', { ...findingState, disposition: 'FALSE_POSITIVE' }],
      ['severity', { ...findingState, severity: 'LOW' }],
      ['provenance', { ...findingState, provenance: 'LLM_JUDGE' }],
      ['fingerprint', { ...findingState, fingerprint: 'fp-2' }],
      ['ruleId', { ...findingState, ruleId: 'ext:semgrep:xss' }],
      ['suggestion', { ...findingState, suggestedDisposition: null }],
    ]
    for (const [label, state] of drifts) {
      const drifted = { ...findingSubject, stateHash: findingStateHash(state) }
      expect({
        label,
        verdict: verifyReadReceipt(SECRET, ack.issued.receipt, drifted, T2),
      }).toEqual({ label, verdict: { ok: false, reason: 'mismatch' } })
    }
    // Another ruling, another finding, another caller: mismatch.
    for (const drift of [
      { target: 'FALSE_POSITIVE' as const },
      { crossingId: 'f-2' },
      { memberId: 'm-2' },
      { sessionId: 'sess-1' },
    ]) {
      expect(
        verifyReadReceipt(
          SECRET,
          ack.issued.receipt,
          { ...findingSubject, ...drift },
          T2
        )
      ).toEqual({ ok: false, reason: 'mismatch' })
    }
  })

  it('the kind is signed in: a crossing receipt is never accepted for a finding with the same id, and vice versa', () => {
    const asCrossing: ReceiptSubject = {
      ...findingSubject,
      kind: 'crossing',
      target: 'FALSE_POSITIVE',
    }
    const asFinding: ReceiptSubject = { ...asCrossing, kind: 'finding' }
    const r1 = issueReadReceipt(SECRET, asCrossing, T0)
    expect(verifyReadReceipt(SECRET, r1.receipt, asFinding, T1)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    const f1 = issueReadReceipt(SECRET, asFinding, T0)
    expect(verifyReadReceipt(SECRET, f1.receipt, asCrossing, T1)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    // An absent kind is the LUM-769 crossing message, byte for byte.
    const legacy: ReceiptSubject = { ...asCrossing }
    delete legacy.kind
    expect(verifyReadReceipt(SECRET, r1.receipt, legacy, T1)).toMatchObject({
      ok: true,
    })
  })

  it('the bulk set hash is order-independent and changes when a row joins, leaves or changes', () => {
    const a = { id: 'f-1', ...findingState }
    const b = { id: 'f-2', ...findingState, fingerprint: 'fp-2' }
    expect(findingsSetStateHash([a, b])).toBe(findingsSetStateHash([b, a]))
    expect(findingsSetStateHash([a])).not.toBe(findingsSetStateHash([a, b]))
    expect(findingsSetStateHash([a, b])).not.toBe(
      findingsSetStateHash([a, { ...b, disposition: 'FALSE_POSITIVE' }])
    )
    const bulk: ReceiptSubject = {
      kind: 'findings',
      crossingId: 'task:t-1',
      taskId: 't-1',
      target: 'FALSE_POSITIVE',
      sessionId: null,
      memberId: 'm-1',
      stateHash: findingsSetStateHash([a, b]),
    }
    const r1 = issueReadReceipt(SECRET, bulk, T0)
    expect(verifyReadReceipt(SECRET, r1.receipt, bulk, T1)).toMatchObject({
      ok: true,
    })
    expect(
      verifyReadReceipt(
        SECRET,
        r1.receipt,
        { ...bulk, stateHash: findingsSetStateHash([a]) },
        T1
      )
    ).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('describeReceiptFailure names the next step and the subject', () => {
    expect(
      describeReceiptFailure(
        { ok: false, reason: 'not_acknowledged' },
        '--confirm'
      )
    ).toContain('--confirm-read')
    expect(
      describeReceiptFailure(
        { ok: false, reason: 'expired' },
        '--confirm',
        'finding'
      )
    ).toContain('read the finding again')
    expect(
      describeReceiptFailure(
        { ok: false, reason: 'mismatch' },
        '--confirm-read',
        'findings'
      )
    ).toContain('the suggested findings')
    expect(
      describeReceiptFailure({ ok: false, reason: 'malformed' }, '--confirm')
    ).toContain('malformed')
  })
})
