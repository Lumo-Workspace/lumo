/**
 * @jest-environment node
 *
 * LUM-1130 — the request-changes / approve decision (pure). Each approve
 * precondition, taken false on its own, means no approval; a head that moved
 * between the check and the submit means no approval; the mode off means
 * Lumo never requests changes and never approves.
 */
import {
  canSubmitApproval,
  decideReviewVerdict,
  isReviewComplete,
  standingLumoReview,
  type VerdictInput,
} from '@/ee/security/services/pr-review-verdict'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD = '1111111111111111111111111111111111111111'

/** Every approve precondition true. */
function approvable(over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    enabled: true,
    headSha: HEAD,
    scan: {
      status: 'FINDINGS',
      partial: false,
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'RAN' },
    },
    openThreads: 0,
    blocking: 0,
    unpostedActionable: 0,
    standing: { state: 'CHANGES_REQUESTED', commitId: OLD },
    ...over,
  }
}

describe('isReviewComplete', () => {
  it('a finished scan whose every layer ran is complete', () => {
    expect(isReviewComplete(approvable().scan)).toBe(true)
  })

  it.each(['PAUSED', 'PENDING', 'PARTIAL', 'FAILED', 'SUPERSEDED'] as const)(
    'a layer %s ⇒ not complete',
    state => {
      expect(
        isReviewComplete({
          status: 'FINDINGS',
          partial: false,
          stages: { secrets: 'RAN', judge: state },
        })
      ).toBe(false)
    }
  )

  it.each(['DISABLED', 'SKIPPED', 'NOT_CONFIGURED'] as const)(
    'a layer that is not enabled (%s) does not hold approval back',
    state => {
      expect(
        isReviewComplete({
          status: 'CLEAN',
          partial: false,
          stages: { secrets: 'RAN', hunt: state },
        })
      ).toBe(true)
    }
  )

  it.each(['PENDING', 'RUNNING', 'FAILED'] as const)(
    'scan status %s ⇒ not complete',
    status => {
      expect(
        isReviewComplete({ ...approvable().scan, status: status as never })
      ).toBe(false)
    }
  )

  it('a partial scan ⇒ not complete', () => {
    expect(isReviewComplete({ ...approvable().scan, partial: true })).toBe(
      false
    )
  })

  it('no stages recorded ⇒ not complete', () => {
    expect(
      isReviewComplete({ status: 'CLEAN', partial: false, stages: null })
    ).toBe(false)
  })
})

describe('decideReviewVerdict', () => {
  it('every precondition true ⇒ APPROVE', () => {
    expect(decideReviewVerdict(approvable()).kind).toBe('APPROVE')
  })

  it('approves when Lumo never reviewed before', () => {
    expect(
      decideReviewVerdict(
        approvable({ standing: { state: null, commitId: null } })
      ).kind
    ).toBe('APPROVE')
  })

  // Each approve precondition individually false ⇒ no approve.
  it.each<[string, Partial<VerdictInput>]>([
    ['mode off', { enabled: false }],
    [
      'a layer paused',
      {
        scan: {
          status: 'FINDINGS',
          partial: false,
          stages: { secrets: 'RAN', judge: 'PAUSED' },
        },
      },
    ],
    [
      'a layer still running',
      {
        scan: {
          status: 'FINDINGS',
          partial: false,
          stages: { secrets: 'RAN', hunt: 'PENDING' },
        },
      },
    ],
    [
      'scan partial',
      {
        scan: {
          status: 'FINDINGS',
          partial: true,
          stages: { secrets: 'RAN' },
        },
      },
    ],
    [
      'scan not finished',
      {
        scan: { status: 'RUNNING', partial: false, stages: { secrets: 'RAN' } },
      },
    ],
    ['an open Lumo thread', { openThreads: 1 }],
    ['a blocking finding', { blocking: 1 }],
    ['an actionable finding not yet on the PR', { unpostedActionable: 1 }],
    [
      'already approved on this head',
      { standing: { state: 'APPROVED', commitId: HEAD } },
    ],
  ])('%s ⇒ no APPROVE', (_label, over) => {
    expect(decideReviewVerdict(approvable(over)).kind).not.toBe('APPROVE')
  })

  it('an approval of an older head is renewed on a clean new head', () => {
    expect(
      decideReviewVerdict(
        approvable({ standing: { state: 'APPROVED', commitId: OLD } })
      ).kind
    ).toBe('APPROVE')
  })

  it('a blocking finding resolved on GitHub still blocks: blocking counts, threads do not', () => {
    // The thread is closed (0 open), the finding still blocks DONE.
    const v = decideReviewVerdict(
      approvable({
        openThreads: 0,
        blocking: 1,
        standing: { state: 'APPROVED', commitId: OLD },
      })
    )
    expect(v.kind).toBe('REQUEST_CHANGES')
  })

  it('open threads ⇒ REQUEST_CHANGES when Lumo does not already request changes', () => {
    expect(
      decideReviewVerdict(
        approvable({
          openThreads: 2,
          standing: { state: null, commitId: null },
        })
      ).kind
    ).toBe('REQUEST_CHANGES')
    expect(
      decideReviewVerdict(
        approvable({
          openThreads: 2,
          standing: { state: 'APPROVED', commitId: OLD },
        })
      ).kind
    ).toBe('REQUEST_CHANGES')
  })

  it('open threads while Lumo already requests changes ⇒ NONE (no repeat review)', () => {
    expect(decideReviewVerdict(approvable({ openThreads: 2 })).kind).toBe(
      'NONE'
    )
  })

  it('requests changes even before every layer finished (a finding is a finding)', () => {
    expect(
      decideReviewVerdict(
        approvable({
          blocking: 1,
          standing: { state: null, commitId: null },
          scan: {
            status: 'RUNNING',
            partial: false,
            stages: { secrets: 'RAN', hunt: 'PENDING' },
          },
        })
      ).kind
    ).toBe('REQUEST_CHANGES')
  })

  it('mode off ⇒ NONE whatever is open (only COMMENT reviews)', () => {
    for (const over of [
      { openThreads: 3 },
      { blocking: 1 },
      {},
    ] as Partial<VerdictInput>[]) {
      expect(
        decideReviewVerdict(
          approvable({
            ...over,
            enabled: false,
            standing: { state: null, commitId: null },
          })
        ).kind
      ).toBe('NONE')
    }
  })
})

describe('canSubmitApproval — the head re-read right before submitting', () => {
  it('same head, open PR ⇒ true', () => {
    expect(canSubmitApproval(HEAD, { sha: HEAD, state: 'open' })).toBe(true)
  })
  it('the head moved between check and submit ⇒ false', () => {
    expect(canSubmitApproval(HEAD, { sha: OLD, state: 'open' })).toBe(false)
  })
  it('the PR closed ⇒ false', () => {
    expect(canSubmitApproval(HEAD, { sha: HEAD, state: 'closed' })).toBe(false)
  })
  it('the head could not be read ⇒ false', () => {
    expect(canSubmitApproval(HEAD, null)).toBe(false)
  })
})

describe('standingLumoReview', () => {
  const bot = { login: 'uselumo[bot]', type: 'Bot' }
  const human = { login: 'alice', type: 'User' }
  const prev = process.env.GITHUB_APP_SLUG
  beforeAll(() => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.GITHUB_APP_SLUG
    else process.env.GITHUB_APP_SLUG = prev
  })

  it('the last APPROVED / CHANGES_REQUESTED Lumo review stands; comments and dismissed ones do not', () => {
    const s = standingLumoReview([
      { id: 1, state: 'CHANGES_REQUESTED', commit_id: OLD, user: bot },
      { id: 2, state: 'COMMENTED', commit_id: OLD, user: bot },
      { id: 3, state: 'APPROVED', commit_id: HEAD, user: human },
      { id: 4, state: 'DISMISSED', commit_id: OLD, user: bot },
    ])
    expect(s).toEqual({
      state: 'CHANGES_REQUESTED',
      commitId: OLD,
      changesRequestedIds: [1],
    })
  })

  it('no Lumo verdict yet ⇒ null state', () => {
    expect(
      standingLumoReview([
        { id: 2, state: 'COMMENTED', commit_id: OLD, user: bot },
      ])
    ).toEqual({ state: null, commitId: null, changesRequestedIds: [] })
  })

  it('an approval after a change request stands, the change request is still listed for dismissal', () => {
    const s = standingLumoReview([
      { id: 1, state: 'CHANGES_REQUESTED', commit_id: OLD, user: bot },
      { id: 5, state: 'APPROVED', commit_id: HEAD, user: bot },
    ])
    expect(s.state).toBe('APPROVED')
    expect(s.commitId).toBe(HEAD)
    expect(s.changesRequestedIds).toEqual([1])
  })

  it('a human review is never Lumo’s', () => {
    expect(
      standingLumoReview([
        { id: 1, state: 'CHANGES_REQUESTED', commit_id: OLD, user: human },
      ]).state
    ).toBeNull()
  })
})
