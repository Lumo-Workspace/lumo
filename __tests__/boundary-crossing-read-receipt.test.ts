/**
 * @jest-environment node
 *
 * LUM-769 — the read receipt is a stateless, server-signed proof that the
 * envelope step ran for THIS crossing, THIS ruling, THIS caller, against the
 * crossing's CURRENT state. Anything else fails verification.
 */
import {
  crossingStateHash,
  issueReadReceipt,
  readReceiptSecret,
  verifyReadReceipt,
  READ_RECEIPT_TTL_MS,
  type ReceiptCrossingState,
  type ReceiptSubject,
} from '@/lib/boundary-crossing/read-receipt'

const SECRET = 'test-secret'
const T0 = new Date('2026-09-14T10:00:00.000Z')

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

describe('read receipt (LUM-769)', () => {
  it('receipt round-trips for the same subject and state, within its TTL', () => {
    const issued = issueReadReceipt(SECRET, subject, T0)
    expect(issued.receipt).toMatch(/^r1\.\d+\.\d+\.[A-Za-z0-9_-]+$/)
    expect(issued.expiresAt).toBe(
      new Date(T0.getTime() + READ_RECEIPT_TTL_MS).toISOString()
    )
    expect(
      verifyReadReceipt(
        SECRET,
        issued.receipt,
        subject,
        new Date(T0.getTime() + 1000)
      )
    ).toEqual({ ok: true })
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
    'receipt is rejected as mismatch when used for %s',
    (_label, drift) => {
      const issued = issueReadReceipt(SECRET, subject, T0)
      expect(
        verifyReadReceipt(SECRET, issued.receipt, { ...subject, ...drift }, T0)
      ).toEqual({ ok: false, reason: 'mismatch' })
    }
  )

  it('receipt is voided by any change to the crossing state it was read against', () => {
    const issued = issueReadReceipt(SECRET, subject, T0)
    const drifts: Array<Partial<typeof state>> = [
      { disposition: 'CONFIRMED' },
      { occurrenceCount: 3, lastSeenAt: '2026-09-14T09:30:00.000Z' },
      { explanationIds: ['ex-1', 'ex-2', 'ex-3'] },
      { detail: 'deleted __tests__/y.test.ts' },
      { severity: 'HIGH' },
    ]
    for (const d of drifts) {
      const changed = {
        ...subject,
        stateHash: crossingStateHash({ ...state, ...d }),
      }
      expect(verifyReadReceipt(SECRET, issued.receipt, changed, T0)).toEqual({
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
    const issued = issueReadReceipt(SECRET, subject, T0)
    expect(
      verifyReadReceipt(
        SECRET,
        issued.receipt,
        subject,
        new Date(T0.getTime() + READ_RECEIPT_TTL_MS + 1)
      )
    ).toEqual({ ok: false, reason: 'expired' })
    expect(verifyReadReceipt('other', issued.receipt, subject, T0)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    const [v, iat, exp] = issued.receipt.split('.')
    expect(
      verifyReadReceipt(SECRET, `${v}.${iat}.${exp}.AAAA`, subject, T0)
    ).toEqual({ ok: false, reason: 'mismatch' })
    // Stretching the expiry breaks the signature — exp is inside the message.
    expect(
      verifyReadReceipt(
        SECRET,
        `${v}.${iat}.${Number(exp) + 60_000}.${issued.receipt.split('.')[3]}`,
        subject,
        T0
      )
    ).toEqual({ ok: false, reason: 'mismatch' })
    for (const bad of ['', 'r1', 'r0.1.2.sig', 'r1.x.y.sig', 'r1.1.2.']) {
      expect(verifyReadReceipt(SECRET, bad, subject, T0)).toEqual({
        ok: false,
        reason: 'malformed',
      })
    }
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
