/**
 * @jest-environment node
 *
 * LUM-1200 follow-up #2 — a hunt / grouped thread is never marked
 * "✅ Addressed" while its issue is still reported. Production (probe PR 64,
 * src/probe/order.ts @4cb6b57): a full re-review on the same head reworded
 * the hunt's parseQuantity report; the AI review still reported the issue
 * (relabelled, and carried by its own thread), and the hunt's thread was
 * resolved as addressed.
 */
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {},
}))
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {},
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => ({
  prCommentClient: {},
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  planDuplicateMerges,
  planThreadActions,
} from '@/ee/security/services/pr-finding-thread.service'
import type { FindingThreadRow } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'
import type { FindingIdentity } from '@/ee/security/security-scan/finding-successor'
import type { ReviewThreadState } from '@/lib/integrations/github/review-threads'

const HEAD = '4cb6b57000000000000000000000000000000000'
const FILE = 'src/probe/order.ts'
const KEY = 'test-identity-key'
const COMPLETE = {
  status: 'FINDINGS' as const,
  stages: {
    secrets: 'RAN',
    external: 'RAN',
    judge: 'RAN',
    hunt: 'RAN',
  } as const,
  judgeReviewScope: null,
}

function row(over: Partial<FindingThreadRow>): FindingThreadRow {
  return {
    id: 't',
    pullRequestId: 'pr1',
    fingerprint: 'fp',
    commentId: '1',
    threadNodeId: 'PRRT_1',
    state: 'OPEN',
    ruleId: 'hunt:logic',
    provenance: 'LLM_JUDGE',
    kind: 'VULNERABILITY',
    filePath: FILE,
    resolvedByLogin: null,
    addressedInSha: null,
    ...over,
  }
}

function finding(over: Partial<ReviewFindingRow>): ReviewFindingRow {
  return {
    id: 'f',
    kind: 'CORRECTNESS',
    ruleId: 'review:api_misuse',
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath: FILE,
    line: 13,
    title: 'x',
    detail: 'd',
    fingerprint: 'fp',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

const identity = (
  f: Pick<
    ReviewFindingRow,
    'fingerprint' | 'ruleId' | 'line' | 'title' | 'severity'
  >,
  evidence: string | null = null
): FindingIdentity => ({
  fingerprint: f.fingerprint,
  ruleId: f.ruleId,
  provenance: 'LLM_JUDGE',
  filePath: FILE,
  line: f.line,
  title: f.title,
  severity: f.severity,
  evidence,
})

const remote = (id: string, commentId: number): ReviewThreadState => ({
  id,
  isResolved: false,
  isOutdated: false,
  resolvedBy: null,
  firstCommentId: commentId,
})

// The AI review's thread (r1 L13) and the hunt's own thread (r1 L11).
const judgeOld = {
  fingerprint: 'fp-judge-logic',
  ruleId: 'review:logic_error',
  line: 13,
  severity: 'MEDIUM' as const,
  title: 'parseQuantity returns unvalidated JSON.parse result typed as number',
}
const huntOld = {
  fingerprint: 'fp-hunt-medium',
  ruleId: 'hunt:logic',
  line: 11,
  severity: 'MEDIUM' as const,
  title:
    'JSON.parse succeeds on non-numeric JSON values without throwing, allowing them to be returned and bypass the numeric validation that the catch block would catch for actual parse errors',
}
const judgeRow = row({
  id: 't-judge',
  fingerprint: judgeOld.fingerprint,
  ruleId: judgeOld.ruleId,
  kind: 'CORRECTNESS',
  commentId: '10',
  threadNodeId: 'PRRT_fI5',
})
const huntRow = row({
  id: 't-hunt',
  fingerprint: huntOld.fingerprint,
  commentId: '20',
  threadNodeId: 'PRRT_h6n',
})
// r2: the AI review relabels the issue; the hunt no longer reports it.
const judgeNow = finding({
  fingerprint: 'fp-judge-api',
  ruleId: 'review:api_misuse',
  line: 13,
  title: 'JSON.parse result returned unvalidated as number',
})
const protoHunt = finding({
  fingerprint: 'fp-hunt-proto',
  ruleId: 'hunt:logic',
  kind: 'VULNERABILITY',
  line: 7,
  title:
    'Prototype property lookup in DISCOUNTS object allows attacker to bypass discount allowlist',
})

function plan(
  findings: ReviewFindingRow[],
  rows: FindingThreadRow[] = [judgeRow, huntRow],
  identityKey: string | null = null
) {
  return planThreadActions({
    rows,
    findings,
    open: findings,
    scan: COMPLETE,
    headSha: HEAD,
    remote: new Map(
      rows.map(r => [r.commentId, remote(r.threadNodeId!, Number(r.commentId))])
    ),
    identities: new Map(
      [judgeOld, huntOld, ...findings].map(f => [f.fingerprint, identity(f)])
    ),
    identityKey,
  })
}

describe('LUM-1200 follow-up #2 — a thread whose issue is still reported is not addressed', () => {
  it.each([null, KEY])(
    'probe PR 64 r2 (key %s): the AI review thread carries the relabel; the hunt thread stays open',
    key => {
      const out = plan([judgeNow, protoHunt], [judgeRow, huntRow], key)
      expect(out.actions).toEqual([
        expect.objectContaining({
          kind: 'CARRY',
          row: expect.objectContaining({ fingerprint: judgeOld.fingerprint }),
          successor: 'fp-judge-api',
        }),
      ])
    }
  )

  it('the AI review alone still reports it (a LOW row with no thread): the hunt thread is carried, not addressed', () => {
    const huntR3 = row({
      id: 't-hunt-14',
      fingerprint: 'fp-hunt-parse-zero',
      commentId: '30',
      threadNodeId: 'PRRT_D47',
    })
    const huntR3Old = {
      fingerprint: 'fp-hunt-parse-zero',
      ruleId: 'hunt:logic',
      line: 14,
      severity: 'MEDIUM' as const,
      title:
        'Parse failures silently default to 0, allowing attackers to craft unparseable quantity strings that result in free orders',
    }
    const lowJudge = finding({
      fingerprint: 'fp-judge-error',
      ruleId: 'review:error_handling',
      severity: 'LOW',
      line: 14,
      title: 'Parse errors silently converted to quantity 0',
    })
    const out = planThreadActions({
      rows: [huntR3],
      findings: [lowJudge],
      open: [lowJudge],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([['30', remote('PRRT_D47', 30)]]),
      identities: new Map([
        [huntR3Old.fingerprint, identity(huntR3Old)],
        [lowJudge.fingerprint, identity(lowJudge)],
      ]),
    })
    // Carried onto the AI review's report when nothing else holds it.
    expect(out.actions).toEqual([
      expect.objectContaining({ kind: 'CARRY', successor: 'fp-judge-error' }),
    ])
  })

  it("the hunt's own rewording, already owning a thread, keeps the old hunt thread open", () => {
    const reworded = finding({
      fingerprint: 'fp-hunt-reworded',
      ruleId: 'hunt:logic',
      kind: 'VULNERABILITY',
      line: 11,
      title: 'JSON.parse output is returned without a numeric check',
    })
    const out = plan(
      [reworded],
      [
        huntRow,
        row({
          id: 't-reworded',
          fingerprint: 'fp-hunt-reworded',
          commentId: '40',
          threadNodeId: 'PRRT_new',
        }),
      ]
    )
    expect(out.actions).toEqual([])
  })

  it('the issue is gone from every layer ⇒ the hunt thread is addressed', () => {
    const out = plan([protoHunt], [huntRow])
    expect(out.actions).toEqual([
      expect.objectContaining({
        kind: 'ADDRESS',
        row: expect.objectContaining({ fingerprint: huntOld.fingerprint }),
      }),
    ])
  })

  it('a report a human dispositioned does not keep the thread open', () => {
    const dismissed = finding({
      ...judgeNow,
      disposition: 'FALSE_POSITIVE' as never,
    })
    const out = planThreadActions({
      rows: [huntRow, judgeRow],
      findings: [dismissed],
      open: [],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([
        ['20', remote('PRRT_h6n', 20)],
        ['10', remote('PRRT_fI5', 10)],
      ]),
      identities: new Map([
        [huntOld.fingerprint, identity(huntOld)],
        [judgeOld.fingerprint, identity(judgeOld)],
        [dismissed.fingerprint, identity(dismissed)],
      ]),
    })
    expect(
      out.actions.find(a => a.row.fingerprint === huntOld.fingerprint)
    ).toEqual(expect.objectContaining({ kind: 'ADDRESS' }))
  })

  it('a verifier-rejected report does not keep the thread open', () => {
    const rejected = finding({
      ...judgeNow,
      verifierVerdict: 'REJECTED' as never,
    })
    const out = planThreadActions({
      rows: [huntRow],
      findings: [rejected],
      open: [],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([['20', remote('PRRT_h6n', 20)]]),
      identities: new Map([
        [huntOld.fingerprint, identity(huntOld)],
        [rejected.fingerprint, identity(rejected)],
      ]),
    })
    expect(out.actions).toEqual([expect.objectContaining({ kind: 'ADDRESS' })])
  })
})

// LUM-1200 follow-up #2 × LUM-1127 follow-up #3 (#1528): the still-reported
// hold and the alias carry / duplicate merge compose — the hunt thread is
// never "Addressed" while its issue is reported; once the AI review thread
// owns the relabelled finding (as an alias), the two threads are merged with
// a duplicate note instead.
describe('composes with alias carries and the duplicate merge', () => {
  const input = (rows: FindingThreadRow[]) => ({
    rows,
    findings: [judgeNow],
    open: [judgeNow],
    scan: COMPLETE,
    headSha: HEAD,
    remote: new Map(
      rows.map(r => [r.commentId, remote(r.threadNodeId!, Number(r.commentId))])
    ),
    identities: new Map(
      [judgeOld, huntOld, judgeNow].map(f => [f.fingerprint, identity(f)])
    ),
  })

  it('sync 1 (relabel just seen): AI thread CARRY, hunt thread held open, no merge yet', () => {
    const i = input([judgeRow, huntRow])
    expect(planDuplicateMerges(i)).toEqual([])
    expect(planThreadActions(i).actions).toEqual([
      expect.objectContaining({ kind: 'CARRY', successor: 'fp-judge-api' }),
    ])
  })

  it('sync 2 (carry saved as an alias): merged into the older AI thread, never addressed', () => {
    const carried = { ...judgeRow, aliasFingerprints: ['fp-judge-api'] }
    const i = input([carried, huntRow])
    expect(planDuplicateMerges(i)).toEqual([
      {
        keep: expect.objectContaining({ fingerprint: judgeOld.fingerprint }),
        drop: expect.objectContaining({ fingerprint: huntOld.fingerprint }),
      },
    ])
    // Even planned without the merge, the hunt thread is not addressed and
    // the AI thread (reported through its alias) needs nothing.
    expect(planThreadActions(i).actions).toEqual([])
  })

  it('after the merge: the kept thread stands for the hunt fingerprint too — nothing to do', () => {
    const merged = {
      ...judgeRow,
      aliasFingerprints: ['fp-judge-api', huntOld.fingerprint],
    }
    expect(planThreadActions(input([merged])).actions).toEqual([])
  })

  it("a hunt thread reported through its own alias is not 'gone'", () => {
    const aliased = {
      ...huntRow,
      aliasFingerprints: ['fp-judge-api'],
    }
    expect(planThreadActions(input([aliased])).actions).toEqual([])
  })
})
