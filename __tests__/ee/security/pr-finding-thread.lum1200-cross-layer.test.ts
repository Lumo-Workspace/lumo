/**
 * @jest-environment node
 *
 * LUM-1200 follow-up #3 — production TC9 (lumo-agent-test#65 / #66): the
 * hunt's thread one line from the AI review's report of the same issue was
 * marked "✅ Addressed" on the same head while the AI review still reported
 * the issue — the hunt's long claim and the AI review's short title share
 * about two words, and the cross-layer match required a similar title.
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

const HEAD = 'b1379df729ad370b97b5033a501ebd9d778e50a7'
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

interface Shape {
  fingerprint: string
  ruleId: string
  filePath: string
  line: number
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  title: string
}

const identity = (f: Shape): FindingIdentity => ({
  ...f,
  provenance: 'LLM_JUDGE',
  evidence: null,
})

function threadRow(f: Shape, commentId: string): FindingThreadRow {
  return {
    id: `t-${f.fingerprint}`,
    pullRequestId: 'pr1',
    fingerprint: f.fingerprint,
    commentId,
    threadNodeId: `PRRT_${commentId}`,
    state: 'OPEN',
    ruleId: f.ruleId,
    provenance: 'LLM_JUDGE',
    kind: 'VULNERABILITY',
    filePath: f.filePath,
    resolvedByLogin: null,
    addressedInSha: null,
  }
}

function finding(f: Shape): ReviewFindingRow {
  return {
    id: `f-${f.fingerprint}`,
    kind: 'VULNERABILITY',
    detail: 'd',
    provenance: 'LLM_JUDGE',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...f,
  }
}

const remote = (id: string, commentId: number): ReviewThreadState => ({
  id,
  isResolved: false,
  isOutdated: false,
  resolvedBy: null,
  firstCommentId: commentId,
})

function input(
  rows: FindingThreadRow[],
  current: Shape[],
  known: Shape[],
  identityKey: string | null
) {
  const findings = current.map(finding)
  return {
    rows,
    findings,
    open: findings,
    scan: COMPLETE,
    headSha: HEAD,
    remote: new Map(
      rows.map(r => [r.commentId, remote(r.threadNodeId!, Number(r.commentId))])
    ),
    identities: new Map(
      [...known, ...current].map(f => [f.fingerprint, identity(f)])
    ),
    identityKey,
  }
}

// #65 r1/r2 (src/server.ts): the AI review at L41 keeps reporting the issue
// (reworded); the hunt's L42 report is gone on the re-review.
const judgeAuth: Shape = {
  fingerprint: '644643f8596f02c4',
  ruleId: 'vuln:auth_bypass',
  filePath: 'src/server.ts',
  line: 41,
  severity: 'HIGH',
  title: 'Unauthenticated session creation for any user name',
}
const huntAuth: Shape = {
  fingerprint: '9d3cc9c299992942',
  ruleId: 'hunt:logic',
  filePath: 'src/server.ts',
  line: 42,
  severity: 'HIGH',
  title:
    'Sessions are created for any arbitrary username without authentication, allowing unauthorized access by specifying any username',
}
// #66 r6/r8 (src/probe/order.ts): the AI review at L7, the hunt at L6.
const judgeProto: Shape = {
  fingerprint: '06f638e93e2a921b',
  ruleId: 'vuln:authz_logic',
  filePath: 'src/probe/order.ts',
  line: 7,
  severity: 'MEDIUM',
  title: 'Discount lookup on plain object reads prototype properties',
}
const huntProto: Shape = {
  fingerprint: '3dd7e9b01ddc0a0a',
  ruleId: 'hunt:logic',
  filePath: 'src/probe/order.ts',
  line: 6,
  severity: 'MEDIUM',
  title:
    'Inherited property access in DISCOUNTS[code] lookup bypasses discount validation, allowing non-numeric truthy values to corrupt order total arithmetic',
}

describe.each([
  ['#65 (auth_bypass L41 / hunt L42)', judgeAuth, huntAuth],
  ['#66 (authz_logic L7 / hunt L6)', judgeProto, huntProto],
])('LUM-1200 follow-up #3 — %s', (_label, judge, hunt) => {
  const rows = [threadRow(judge, '100'), threadRow(hunt, '200')]
  // The AI review still reports the issue, its own fingerprint unchanged
  // (the evidence line keys it), its title reworded.
  const judgeNow = { ...judge, title: `${judge.title} (reworded)` }

  it.each([null, KEY])(
    'the hunt thread is not addressed while the AI review still reports the issue (key %s)',
    key => {
      const out = planThreadActions(input(rows, [judgeNow], [hunt], key))
      expect(out.actions.filter(a => a.kind === 'ADDRESS')).toEqual([])
    }
  )

  it('the gone hunt thread is merged into the older AI review thread', () => {
    expect(planDuplicateMerges(input(rows, [judgeNow], [hunt], null))).toEqual([
      {
        keep: expect.objectContaining({ fingerprint: judge.fingerprint }),
        drop: expect.objectContaining({ fingerprint: hunt.fingerprint }),
      },
    ])
  })

  it('the issue gone from both layers ⇒ the hunt thread is addressed', () => {
    const out = planThreadActions(input([rows[1]!], [], [hunt], null))
    expect(out.actions).toEqual([
      expect.objectContaining({
        kind: 'ADDRESS',
        row: expect.objectContaining({ fingerprint: hunt.fingerprint }),
      }),
    ])
  })

  it('an AI review report four lines away does not hold the hunt thread', () => {
    const far = { ...judgeNow, line: hunt.line + 4 }
    const out = planThreadActions(input([rows[1]!], [far], [hunt], null))
    expect(out.actions).toEqual([expect.objectContaining({ kind: 'ADDRESS' })])
  })
})
