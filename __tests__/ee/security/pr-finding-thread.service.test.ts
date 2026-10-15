/**
 * @jest-environment node
 *
 * LUM-1127 — Lumo's inline finding threads across pushes:
 * resolved as addressed only after a COMPLETE pass of the producing layer
 * over the finding's file, reopened on regression, a human's GitHub resolve
 * recorded and honoured, Lumo's own resolve echo never taken for a human's.
 * Service level: the GitHub clients and the thread repository are mocked.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createReviewLineReply: jest.fn().mockResolvedValue({ id: 1 }),
      listReviewCommentsOfReview: jest.fn().mockResolvedValue([]),
    },
  }
})
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {
    listReviewThreads: jest.fn(),
    resolveThread: jest.fn().mockResolvedValue(undefined),
    unresolveThread: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn(),
    findByThreadRef: jest.fn(),
    upsert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    findLayerMetaByFingerprints: jest.fn().mockResolvedValue([]),
    findIdentitiesByFingerprints: jest.fn().mockResolvedValue([]),
  },
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
  applyReviewThreadEvent,
  buildAddressedNote,
  isLumoActor,
  layerCoveredFile,
  layerOf,
  findingIdentityKey,
  planIdentityWrites,
  planThreadActions,
  prFindingThreadService,
  storedIdentityOf,
  threadIdentityOf,
  type ThreadSyncContext,
} from '@/ee/security/services/pr-finding-thread.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { logger } from '@/lib/logger'
import {
  evidenceHash,
  titleTokens,
} from '@/ee/security/security-scan/finding-successor'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import type { ReviewThreadState } from '@/lib/integrations/github/review-threads'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { FindingThreadRow } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'

const repoMock = prFindingThreadRepository as jest.Mocked<
  typeof prFindingThreadRepository
>
const threads = reviewThreadClient as jest.Mocked<typeof reviewThreadClient>
const reply = prCommentClient.createReviewLineReply as jest.Mock

const HEAD = 'c0ffee1234567890c0ffee1234567890c0ffee12'
const KEY = 'test-identity-key'
const OLD_IDENTITY_KEY = process.env.LUMO_FINDING_IDENTITY_KEY
afterAll(() => {
  if (OLD_IDENTITY_KEY === undefined)
    delete process.env.LUMO_FINDING_IDENTITY_KEY
  else process.env.LUMO_FINDING_IDENTITY_KEY = OLD_IDENTITY_KEY
})

function row(over: Partial<FindingThreadRow> = {}): FindingThreadRow {
  return {
    id: 't1',
    pullRequestId: 'pr1',
    fingerprint: 'fp1',
    commentId: '101',
    threadNodeId: 'PRRT_1',
    state: 'OPEN',
    ruleId: 'vuln:sql_injection',
    provenance: 'LLM_JUDGE',
    kind: 'VULNERABILITY',
    filePath: 'lib/db.ts',
    resolvedByLogin: null,
    addressedInSha: null,
    ...over,
  }
}

function finding(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f1',
    kind: 'VULNERABILITY',
    ruleId: 'vuln:sql_injection',
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath: 'lib/db.ts',
    line: 12,
    title: 'SQL injection',
    detail: 'raw input in query',
    fingerprint: 'fp1',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

function remote(over: Partial<ReviewThreadState> = {}): ReviewThreadState {
  return {
    id: 'PRRT_1',
    isResolved: false,
    isOutdated: false,
    resolvedBy: null,
    firstCommentId: 101,
    ...over,
  }
}

const COMPLETE = {
  status: 'CLEAN' as const,
  stages: {
    secrets: 'RAN',
    external: 'RAN',
    judge: 'RAN',
    hunt: 'RAN',
  } as const,
  judgeReviewScope: null,
}

function ctx(over: Partial<ThreadSyncContext> = {}): ThreadSyncContext {
  return {
    pullRequestId: 'pr1',
    workspaceId: 'w1',
    repo: { owner: 'acme', name: 'app' },
    prNumber: 7,
    token: 'tok',
    headSha: HEAD,
    scan: COMPLETE,
    findings: [],
    open: [],
    comments: [],
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.GITHUB_APP_SLUG
  process.env.LUMO_FINDING_IDENTITY_KEY = KEY
  threads.listReviewThreads.mockResolvedValue([remote()])
  repoMock.findByPullRequest.mockResolvedValue([row()])
  // The thread's finding, as its newest finding row reads (a row recorded
  // before LUM-1127 follow-up #2 keeps no identity of its own).
  repoMock.findIdentitiesByFingerprints.mockResolvedValue([
    {
      fingerprint: 'fp1',
      ruleId: 'vuln:sql_injection',
      provenance: 'LLM_JUDGE',
      filePath: 'lib/db.ts',
      line: 12,
      title: 'SQL injection',
      severity: 'HIGH',
      evidence: 'db.query(sql)',
    },
  ])
})

describe('layer coverage — "fixed" only after a complete pass over the file', () => {
  it('maps each finding to the layer that produced it', () => {
    expect(
      layerOf(row({ provenance: 'DETERMINISTIC', ruleId: 'secret:aws' }))
    ).toBe('secrets')
    expect(
      layerOf(row({ provenance: 'EXTERNAL_TOOL', ruleId: 'ext:semgrep:x' }))
    ).toBe('external')
    expect(
      layerOf(row({ provenance: 'EXTERNAL_TOOL', kind: 'DEPENDENCY' }))
    ).toBe('supplyChain')
    expect(layerOf(row({ ruleId: 'hunt:ssrf' }))).toBe('hunt')
    expect(layerOf(row())).toBe('judge')
  })

  it.each([
    [
      'judge PARTIAL (budget-trimmed)',
      { ...COMPLETE, stages: { ...COMPLETE.stages, judge: 'PARTIAL' } },
    ],
    [
      'judge PAUSED',
      { ...COMPLETE, stages: { ...COMPLETE.stages, judge: 'PAUSED' } },
    ],
    [
      'judge FAILED',
      { ...COMPLETE, stages: { ...COMPLETE.stages, judge: 'FAILED' } },
    ],
    ['scan still RUNNING', { ...COMPLETE, status: 'RUNNING' as const }],
    [
      'incremental scope without the file',
      { ...COMPLETE, judgeReviewScope: ['lib/other.ts'] },
    ],
  ])('not covered: %s', (_label, scan) => {
    expect(layerCoveredFile(scan as never, row())).toBe(false)
  })

  it('covered: whole-diff judge pass, or an incremental scope that read the file', () => {
    expect(layerCoveredFile(COMPLETE, row())).toBe(true)
    expect(
      layerCoveredFile({ ...COMPLETE, judgeReviewScope: ['lib/db.ts'] }, row())
    ).toBe(true)
  })

  it('an external finding waits for the external layer, not the judge', () => {
    const ext = row({ provenance: 'EXTERNAL_TOOL', ruleId: 'ext:semgrep:x' })
    expect(
      layerCoveredFile(
        {
          ...COMPLETE,
          stages: { ...COMPLETE.stages, external: 'PENDING' },
        } as never,
        ext
      )
    ).toBe(false)
  })
})

describe('reconcile — scan-driven transitions', () => {
  it('fingerprint absent after a complete pass ⇒ thread resolved with an addressed note naming the sha', async () => {
    const out = await prFindingThreadService.reconcile(ctx())
    expect(threads.resolveThread).toHaveBeenCalledWith({
      threadId: 'PRRT_1',
      token: 'tok',
    })
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: 101,
        body: buildAddressedNote(HEAD),
      })
    )
    expect(String(reply.mock.calls[0][0].body)).toContain('`c0ffee1`')
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ state: 'ADDRESSED', addressedInSha: HEAD })
    )
    expect(out.counts).toEqual({ open: 0, addressed: 1, resolved: 0 })
  })

  it('fingerprint absent after an incremental pass that did not cover its file ⇒ NOT resolved', async () => {
    const out = await prFindingThreadService.reconcile(
      ctx({ scan: { ...COMPLETE, judgeReviewScope: ['lib/other.ts'] } })
    )
    expect(threads.resolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    expect(repoMock.update).not.toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ state: 'ADDRESSED' })
    )
    expect(out.counts.open).toBe(1)
  })

  it('fingerprint absent while its layer is PAUSED ⇒ NOT resolved', async () => {
    await prFindingThreadService.reconcile(
      ctx({
        scan: { ...COMPLETE, stages: { ...COMPLETE.stages, judge: 'PAUSED' } },
      })
    )
    expect(threads.resolveThread).not.toHaveBeenCalled()
  })

  it('still reported ⇒ left open', async () => {
    const f = finding()
    await prFindingThreadService.reconcile(ctx({ findings: [f], open: [f] }))
    expect(threads.resolveThread).not.toHaveBeenCalled()
    expect(threads.unresolveThread).not.toHaveBeenCalled()
  })

  it('reappears after ADDRESSED ⇒ thread unresolved with a regression note', async () => {
    repoMock.findByPullRequest.mockResolvedValue([
      row({ state: 'ADDRESSED', addressedInSha: 'old' }),
    ])
    threads.listReviewThreads.mockResolvedValue([
      remote({
        isResolved: true,
        resolvedBy: { login: 'uselumo', type: 'Bot' },
      }),
    ])
    const f = finding()
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(threads.unresolveThread).toHaveBeenCalledWith({
      threadId: 'PRRT_1',
      token: 'tok',
    })
    expect(String(reply.mock.calls[0][0].body)).toMatch(
      /Reappeared in `c0ffee1`/
    )
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ state: 'OPEN', addressedInSha: null })
    )
    expect(out.counts.open).toBe(1)
  })

  it('reappears after ADDRESSED on an outdated thread ⇒ fresh comment, counted open (old thread left resolved)', async () => {
    repoMock.findByPullRequest.mockResolvedValue([
      row({ state: 'ADDRESSED', addressedInSha: 'old' }),
    ])
    threads.listReviewThreads.mockResolvedValue([
      remote({
        isResolved: true,
        isOutdated: true,
        resolvedBy: { login: 'uselumo', type: 'Bot' },
      }),
    ])
    const f = finding({ line: 40 })
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(threads.unresolveThread).not.toHaveBeenCalled()
    expect(out.repost.get('fp1')?.oldThreadId).toBeNull()
    expect(out.counts).toEqual({ open: 1, addressed: 0, resolved: 0 })
  })

  it('RESOLVED_BY_USER ⇒ reported back as resolved (so the write-back never re-posts) and never reopened', async () => {
    repoMock.findByPullRequest.mockResolvedValue([
      row({ state: 'RESOLVED_BY_USER', resolvedByLogin: 'alice' }),
    ])
    threads.listReviewThreads.mockResolvedValue([
      remote({
        isResolved: true,
        resolvedBy: { login: 'alice', type: 'User' },
      }),
    ])
    const f = finding()
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(out.resolvedByUser.has('fp1')).toBe(true)
    expect(threads.unresolveThread).not.toHaveBeenCalled()
    expect(out.repost.size).toBe(0)
    expect(out.counts.resolved).toBe(1)
  })

  it('a human resolve the webhook missed is picked up from GitHub', async () => {
    threads.listReviewThreads.mockResolvedValue([
      remote({
        isResolved: true,
        resolvedBy: { login: 'alice', type: 'User' },
      }),
    ])
    const f = finding()
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: 'alice',
      })
    )
    expect(out.resolvedByUser.has('fp1')).toBe(true)
  })

  it('outdated comment, finding still reported ⇒ marked for a fresh comment; the old thread is resolved as moved after posting', async () => {
    threads.listReviewThreads.mockResolvedValue([remote({ isOutdated: true })])
    const f = finding({ line: 40 })
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(out.repost.get('fp1')?.oldThreadId).toBe('PRRT_1')
    expect(out.counts).toEqual({ open: 1, addressed: 0, resolved: 0 })
    expect(threads.resolveThread).not.toHaveBeenCalled()
    ;(
      prCommentClient.listReviewCommentsOfReview as jest.Mock
    ).mockResolvedValue([
      {
        id: 202,
        body: 'x\n\n<!-- lumo-security:fp:fp1 -->',
        user: { type: 'Bot' },
      },
    ])
    await prFindingThreadService.recordPosted(ctx(), 9, [f], out.repost)
    expect(threads.resolveThread).toHaveBeenCalledWith({
      threadId: 'PRRT_1',
      token: 'tok',
    })
    expect(String(reply.mock.calls[0][0].body)).toMatch(/Moved in `c0ffee1`/)
    expect(repoMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: 'fp1',
        commentId: '202',
        state: 'OPEN',
      })
    )
  })

  it('a verifier-rejected finding dismisses its thread without touching GitHub', async () => {
    const f = finding({ verifierVerdict: 'REJECTED' })
    await prFindingThreadService.reconcile(ctx({ findings: [f], open: [] }))
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ state: 'DISMISSED' })
    )
    expect(threads.resolveThread).not.toHaveBeenCalled()
  })

  it('adopts a marker comment posted before the table existed', async () => {
    repoMock.findByPullRequest
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        row({ id: 't9', fingerprint: 'fp9', commentId: '909' }),
      ])
    threads.listReviewThreads.mockResolvedValue([
      remote({ id: 'PRRT_9', firstCommentId: 909 }),
    ])
    repoMock.findLayerMetaByFingerprints.mockResolvedValue([
      {
        fingerprint: 'fp9',
        ruleId: 'secret:aws',
        provenance: 'DETERMINISTIC',
        kind: 'SECRET',
        filePath: 'a.ts',
      },
    ])
    await prFindingThreadService.reconcile(
      ctx({
        comments: [
          {
            id: 909,
            node_id: 'n',
            html_url: '',
            updated_at: '',
            body: 'x <!-- lumo-security:fp:fp9 -->',
            user: { id: 1, type: 'Bot', login: 'uselumo[bot]' },
          },
        ],
      })
    )
    expect(repoMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: 'fp9',
        commentId: '909',
        threadNodeId: 'PRRT_9',
        state: 'OPEN',
      })
    )
  })

  it('a GitHub read failure leaves every thread alone', async () => {
    threads.listReviewThreads.mockRejectedValue(new Error('boom'))
    repoMock.findByPullRequest.mockResolvedValue([row({ threadNodeId: null })])
    await expect(prFindingThreadService.reconcile(ctx())).resolves.toBeDefined()
    expect(threads.resolveThread).not.toHaveBeenCalled()
  })

  it('never throws when the table cannot be read', async () => {
    repoMock.findByPullRequest.mockRejectedValue(new Error('no table'))
    const out = await prFindingThreadService.reconcile(ctx())
    expect(out.resolvedByUser.size).toBe(0)
  })
})

describe('planThreadActions — a human-reopened thread is not re-addressed on the same head', () => {
  it('skips ADDRESS when it was already addressed on this head', () => {
    const plan = planThreadActions({
      rows: [row({ addressedInSha: HEAD })],
      findings: [],
      open: [],
      scan: COMPLETE,
      headSha: HEAD,
      remote: null,
    })
    expect(plan.actions).toEqual([])
  })
})

describe("planThreadActions — LUM-1127 a resolve Lumo made itself is not a human's", () => {
  const lumoResolved = remote({
    isResolved: true,
    isOutdated: false,
    resolvedBy: { login: 'uselumo[bot]', type: 'User' },
  })

  it('OPEN row, GitHub resolved by Lumo (GraphQL `User`) ⇒ never RESOLVED_BY_USER', () => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    const plan = planThreadActions({
      rows: [row({ state: 'OPEN' })],
      findings: [],
      open: [],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([['101', lumoResolved]]),
    })
    expect(plan.actions.map(a => a.kind)).toEqual(['ADDRESS'])
  })

  it('RESOLVED_BY_USER recorded for Lumo itself ⇒ healed to ADDRESSED, reopened when reported again', () => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    const f = finding()
    const plan = planThreadActions({
      rows: [
        row({ state: 'RESOLVED_BY_USER', resolvedByLogin: 'uselumo[bot]' }),
      ],
      findings: [f],
      open: [f],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([['101', lumoResolved]]),
    })
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: 'SET_STATE', state: 'ADDRESSED' }),
      expect.objectContaining({ kind: 'REOPEN', threadId: 'PRRT_1' }),
    ])
  })

  it('a human resolve through Lumo (`@app resolve`, reply) keeps RESOLVED_BY_USER', () => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    const f = finding()
    const plan = planThreadActions({
      rows: [row({ state: 'RESOLVED_BY_USER', resolvedByLogin: 'alice' })],
      findings: [f],
      open: [f],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([['101', lumoResolved]]),
    })
    expect(plan.actions).toEqual([])
  })
})

describe('applyReviewThreadEvent — the pull_request_review_thread webhook', () => {
  const event = {
    workspaceId: 'w1',
    pullRequestId: 'pr1',
    action: 'resolved',
    threadNodeId: 'PRRT_1',
    comments: [
      {
        id: 101,
        body: '<!-- lumo-security:fp:fp1 -->',
        user: { type: 'Bot', login: 'uselumo[bot]' },
      },
    ],
    sender: { login: 'alice', type: 'User' },
  }

  it("a human's resolve is recorded as RESOLVED_BY_USER", async () => {
    repoMock.findByThreadRef.mockResolvedValue([row()])
    await expect(applyReviewThreadEvent(event)).resolves.toBe('recorded')
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: 'alice',
      })
    )
  })

  it("Lumo's own resolve echo is NOT recorded as a user action", async () => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    repoMock.findByThreadRef.mockResolvedValue([row()])
    await expect(
      applyReviewThreadEvent({
        ...event,
        sender: { login: 'uselumo[bot]', type: 'Bot' },
      })
    ).resolves.toBe('ignored_self')
    expect(repoMock.update).not.toHaveBeenCalled()
    expect(repoMock.findByThreadRef).not.toHaveBeenCalled()
  })

  it('a human unresolving reopens the thread', async () => {
    repoMock.findByThreadRef.mockResolvedValue([
      row({ state: 'RESOLVED_BY_USER' }),
    ])
    await applyReviewThreadEvent({ ...event, action: 'unresolved' })
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ state: 'OPEN', resolvedByLogin: null })
    )
  })

  it("someone else's thread is ignored", async () => {
    repoMock.findByThreadRef.mockResolvedValue([])
    await expect(
      applyReviewThreadEvent({
        ...event,
        comments: [{ id: 5, body: 'nit', user: { type: 'User' } }],
      })
    ).resolves.toBe('not_lumo_thread')
    expect(repoMock.upsert).not.toHaveBeenCalled()
  })

  it('isLumoActor: REST and GraphQL spellings of the bot, never a user', () => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    expect(isLumoActor({ type: 'Bot', login: 'uselumo[bot]' })).toBe(true)
    expect(isLumoActor({ type: 'Bot', login: 'uselumo' })).toBe(true)
    expect(isLumoActor({ type: 'Bot', login: 'other[bot]' })).toBe(false)
    expect(isLumoActor({ type: 'User', login: 'uselumo' })).toBe(false)
    // GraphQL `resolvedBy` types the bot `User` (LUM-1127 prod, PR 22).
    expect(isLumoActor({ type: 'User', login: 'uselumo[bot]' })).toBe(true)
    expect(isLumoActor({ type: 'User', login: 'other[bot]' })).toBe(false)
  })
})

describe('LUM-1144 — a partial review over the size cap', () => {
  const PARTIAL = {
    ...COMPLETE,
    stages: { ...COMPLETE.stages, judge: 'PARTIAL' as const },
    partialCauses: ['JUDGE_PARTIAL_OVER_CAP'],
  }

  it('a skipped file is never covered: its open thread is not auto-resolved', () => {
    expect(
      layerCoveredFile(
        { ...PARTIAL, judgeReviewScope: ['lib/other.ts'] } as never,
        row()
      )
    ).toBe(false)
  })

  it('a file the partial review read is covered', () => {
    expect(
      layerCoveredFile(
        { ...PARTIAL, judgeReviewScope: ['lib/db.ts'] } as never,
        row()
      )
    ).toBe(true)
  })

  it('without a recorded scope, or with a budget cut too, nothing is covered', () => {
    expect(
      layerCoveredFile({ ...PARTIAL, judgeReviewScope: null } as never, row())
    ).toBe(false)
    expect(
      layerCoveredFile(
        {
          ...PARTIAL,
          partialCauses: ['JUDGE_PARTIAL_OVER_CAP', 'JUDGE_TRUNCATED'],
          judgeReviewScope: ['lib/db.ts'],
        } as never,
        row()
      )
    ).toBe(false)
  })
})

describe('LUM-1144 — reconcile after a partial review over the size cap', () => {
  const partialScan = (scope: string[]) =>
    ({
      ...COMPLETE,
      status: 'FINDINGS' as const,
      stages: { ...COMPLETE.stages, judge: 'PARTIAL' as const },
      partialCauses: ['JUDGE_PARTIAL_OVER_CAP'],
      judgeReviewScope: scope,
    }) as never

  it("a skipped file's open thread is NOT resolved", async () => {
    const out = await prFindingThreadService.reconcile(
      ctx({ scan: partialScan(['lib/other.ts']) })
    )
    expect(threads.resolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    expect(out.counts.open).toBe(1)
  })

  it('a reviewed file whose finding is gone is resolved as addressed', async () => {
    const out = await prFindingThreadService.reconcile(
      ctx({ scan: partialScan(['lib/db.ts']) })
    )
    expect(threads.resolveThread).toHaveBeenCalled()
    expect(out.counts.addressed).toBe(1)
  })
})

/**
 * LUM-1127 follow-up — prod probe PR 52: a full re-review relabelled the
 * same issue's rule id (`review:doc_mismatch` → `review:api_misuse`); the AI
 * review's fingerprint carries the rule id, so the old one looked fixed and
 * its thread was resolved "✅ Addressed" while the finding was still reported.
 */
describe('LUM-1127 follow-up — same issue under a new fingerprint', () => {
  const docRow = () =>
    row({
      fingerprint: 'fp-doc',
      ruleId: 'review:doc_mismatch',
      kind: 'CORRECTNESS',
      filePath: 'scripts/probe.ts',
    })
  const docIdentity = {
    fingerprint: 'fp-doc',
    ruleId: 'review:doc_mismatch',
    provenance: 'LLM_JUDGE' as const,
    filePath: 'scripts/probe.ts',
    line: 3,
    title: 'console.log used in scripts',
    severity: 'LOW' as const,
    evidence: "console.log('probe')",
  }
  const apiFinding = (over: Partial<ReviewFindingRow> = {}) =>
    finding({
      fingerprint: 'fp-api',
      ruleId: 'review:api_misuse',
      kind: 'CORRECTNESS',
      severity: 'LOW',
      filePath: 'scripts/probe.ts',
      line: 3,
      title: 'console.log used in scripts',
      ...over,
    })
  const plan = (
    over: Partial<Parameters<typeof planThreadActions>[0]> = {}
  ) => {
    const f = apiFinding()
    return planThreadActions({
      rows: [docRow()],
      findings: [f],
      open: [f],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([['101', remote()]]),
      identities: new Map([
        ['fp-doc', docIdentity],
        ['fp-api', { ...docIdentity, fingerprint: 'fp-api' }],
      ]),
      ...over,
    })
  }

  it('relabelled rule id ⇒ CARRY to the new fingerprint, never ADDRESS', () => {
    expect(plan().actions).toEqual([
      expect.objectContaining({ kind: 'CARRY', successor: 'fp-api' }),
    ])
  })

  it('without identities (matching off) the old rule applies: ADDRESS', () => {
    expect(plan({ identities: undefined }).actions).toEqual([
      expect.objectContaining({ kind: 'ADDRESS' }),
    ])
  })

  it('identity lookup failed (null) ⇒ no action on an AI-layer thread this sync', () => {
    expect(plan({ identities: null }).actions).toEqual([])
  })

  it('identity lookup failed does not hold a deterministic thread', () => {
    expect(
      plan({
        identities: null,
        rows: [
          row({
            fingerprint: 'fp-secret',
            provenance: 'DETERMINISTIC',
            ruleId: 'secret:aws',
            kind: 'SECRET',
          }),
        ],
      }).actions
    ).toEqual([expect.objectContaining({ kind: 'ADDRESS' })])
  })

  it('the successor already owns a thread ⇒ the old one is addressed', () => {
    expect(
      plan({
        rows: [
          docRow(),
          row({ id: 't2', fingerprint: 'fp-api', commentId: '202' }),
        ],
      }).actions
    ).toEqual([
      expect.objectContaining({
        kind: 'ADDRESS',
        row: expect.objectContaining({ fingerprint: 'fp-doc' }),
      }),
    ])
  })

  it('a verifier-rejected successor continues nothing', () => {
    const f = apiFinding({ verifierVerdict: 'REJECTED' as never })
    const out = plan({ findings: [f], open: [] })
    expect(out.actions).toEqual([expect.objectContaining({ kind: 'ADDRESS' })])
  })

  it('a different issue on the same file ⇒ ADDRESS', () => {
    const f = apiFinding({
      ruleId: 'review:error_handling',
      line: 9,
      title: 'Rejected promise from run is never handled',
    })
    expect(
      plan({
        findings: [f],
        open: [f],
        identities: new Map([['fp-doc', docIdentity]]),
      }).actions
    ).toEqual([expect.objectContaining({ kind: 'ADDRESS' })])
  })

  it('outdated thread and an inline successor ⇒ REPOST for the new fingerprint', () => {
    const f = apiFinding({ severity: 'MEDIUM', line: 5 })
    expect(
      plan({
        findings: [f],
        open: [f],
        remote: new Map([['101', remote({ isOutdated: true })]]),
      }).actions
    ).toEqual([
      expect.objectContaining({
        kind: 'REPOST',
        fingerprint: 'fp-api',
        threadId: 'PRRT_1',
      }),
    ])
  })

  it('reconcile: the thread stays open, no note, and the new fingerprint is reported as carried', async () => {
    repoMock.findByPullRequest.mockResolvedValue([docRow()])
    repoMock.findIdentitiesByFingerprints.mockResolvedValue([
      docIdentity,
      { ...docIdentity, fingerprint: 'fp-api', ruleId: 'review:api_misuse' },
    ])
    const f = apiFinding()
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(repoMock.findIdentitiesByFingerprints).toHaveBeenCalledWith('pr1', [
      'fp-doc',
      'fp-api',
    ])
    expect(threads.resolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    // One write: the carry is kept on the row (LUM-1127 follow-up #3) and
    // the thread's identity moves on to the relabelled finding.
    expect(repoMock.update).toHaveBeenCalledTimes(1)
    expect(repoMock.update).toHaveBeenCalledWith('t1', {
      aliasFingerprints: ['fp-api'],
      identityRuleId: 'review:api_misuse',
      identityLine: 3,
      identitySeverity: 'LOW',
      identityEvidenceHash: evidenceHash("console.log('probe')", KEY),
      identityTitleTokens: titleTokens('console.log used in scripts', KEY),
    })
    expect(out.carried).toEqual(new Map([['fp-api', 'fp-doc']]))
    expect(out.counts).toEqual({ open: 1, addressed: 0, resolved: 0 })
  })

  it('reconcile: a failed identity read resolves nothing (retried next sync)', async () => {
    repoMock.findByPullRequest.mockResolvedValue([docRow()])
    repoMock.findIdentitiesByFingerprints.mockRejectedValue(
      new Error('db down')
    )
    const f = apiFinding()
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(threads.resolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    expect(out.counts.open).toBe(1)
  })
})

/**
 * LUM-1127 follow-up — a thread the developer resolved is not re-raised for
 * the same issue under a new fingerprint (unless it blocks DONE or is more
 * severe); a thread Lumo addressed is (a reappearance is a regression).
 */
describe('LUM-1127 follow-up — human-resolved thread, same issue relabelled', () => {
  const resolvedRow = (over: Partial<FindingThreadRow> = {}) =>
    row({
      fingerprint: 'fp-doc',
      ruleId: 'review:doc_mismatch',
      kind: 'CORRECTNESS',
      filePath: 'scripts/probe.ts',
      state: 'RESOLVED_BY_USER',
      resolvedByLogin: 'alice',
      ...over,
    })
  const docIdentity = {
    fingerprint: 'fp-doc',
    ruleId: 'review:doc_mismatch',
    provenance: 'LLM_JUDGE' as const,
    filePath: 'scripts/probe.ts',
    line: 3,
    title: 'console.log used in scripts',
    severity: 'MEDIUM' as const,
    evidence: "console.log('probe')",
  }
  const apiFinding = (over: Partial<ReviewFindingRow> = {}) =>
    finding({
      fingerprint: 'fp-api',
      ruleId: 'review:api_misuse',
      kind: 'CORRECTNESS',
      severity: 'MEDIUM',
      filePath: 'scripts/probe.ts',
      line: 3,
      title: 'console.log used in scripts',
      ...over,
    })
  const humanResolved = remote({
    isResolved: true,
    resolvedBy: { login: 'alice', type: 'User' },
  })
  const plan = (
    f: ReviewFindingRow,
    over: Partial<Parameters<typeof planThreadActions>[0]> = {}
  ) =>
    planThreadActions({
      rows: [resolvedRow()],
      findings: [f],
      open: [f],
      scan: COMPLETE,
      headSha: HEAD,
      remote: new Map([['101', humanResolved]]),
      identities: new Map([
        ['fp-doc', docIdentity],
        ['fp-api', { ...docIdentity, fingerprint: 'fp-api' }],
      ]),
      ...over,
    })

  it('same or lower severity ⇒ CARRY onto the resolved thread', () => {
    expect(plan(apiFinding()).actions).toEqual([
      expect.objectContaining({ kind: 'CARRY', successor: 'fp-api' }),
    ])
    expect(plan(apiFinding({ severity: 'LOW' })).actions).toEqual([
      expect.objectContaining({ kind: 'CARRY', successor: 'fp-api' }),
    ])
  })

  it('more severe than the resolved finding ⇒ not carried (posted as today)', () => {
    expect(plan(apiFinding({ severity: 'HIGH' })).actions).toEqual([])
  })

  it('blocks DONE ⇒ not carried', () => {
    expect(plan(apiFinding(), { isBlocking: () => true }).actions).toEqual([])
  })

  it('resolved severity unknown ⇒ not carried', () => {
    const { severity: _drop, ...noSeverity } = docIdentity
    expect(
      plan(apiFinding(), {
        identities: new Map([
          ['fp-doc', noSeverity],
          ['fp-api', { ...noSeverity, fingerprint: 'fp-api' }],
        ]),
      }).actions
    ).toEqual([])
  })

  it('a thread Lumo addressed is not carried — a reappearance is re-raised', () => {
    expect(
      plan(apiFinding(), {
        rows: [
          resolvedRow({
            state: 'ADDRESSED',
            resolvedByLogin: null,
            addressedInSha: 'old',
          }),
        ],
        remote: new Map([
          [
            '101',
            remote({
              isResolved: true,
              resolvedBy: { login: 'uselumo[bot]', type: 'Bot' },
            }),
          ],
        ]),
      }).actions
    ).toEqual([])
  })

  it('an OPEN thread takes the successor before a resolved one', () => {
    const out = plan(apiFinding(), {
      rows: [
        resolvedRow(),
        row({
          id: 't2',
          fingerprint: 'fp-open',
          commentId: '202',
          ruleId: 'review:doc_mismatch',
          kind: 'CORRECTNESS',
          filePath: 'scripts/probe.ts',
        }),
      ],
      remote: new Map([
        ['101', humanResolved],
        ['202', remote({ id: 'PRRT_2', firstCommentId: 202 })],
      ]),
      identities: new Map([
        ['fp-doc', docIdentity],
        ['fp-open', { ...docIdentity, fingerprint: 'fp-open' }],
        ['fp-api', { ...docIdentity, fingerprint: 'fp-api' }],
      ]),
    })
    expect(out.actions).toEqual([
      expect.objectContaining({
        kind: 'CARRY',
        successor: 'fp-api',
        row: expect.objectContaining({ fingerprint: 'fp-open' }),
      }),
    ])
  })

  it('reconcile: the carried fingerprint is reported resolved — never posted, stays resolved, no reply', async () => {
    repoMock.findByPullRequest.mockResolvedValue([resolvedRow()])
    threads.listReviewThreads.mockResolvedValue([humanResolved])
    repoMock.findIdentitiesByFingerprints.mockResolvedValue([
      docIdentity,
      { ...docIdentity, fingerprint: 'fp-api', ruleId: 'review:api_misuse' },
    ])
    const f = apiFinding()
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(out.resolvedByUser).toEqual(new Set(['fp-doc', 'fp-api']))
    expect(out.carried).toEqual(new Map([['fp-api', 'fp-doc']]))
    expect(threads.unresolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    // No state write — only the identity, keeping the resolved severity.
    expect(repoMock.update).toHaveBeenCalledTimes(1)
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.not.objectContaining({ state: expect.anything() })
    )
    expect(repoMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ identitySeverity: docIdentity.severity })
    )
    expect(out.counts).toEqual({ open: 0, addressed: 0, resolved: 1 })
  })
})

/**
 * LUM-1127 follow-up #2 — prod probe PR 60: repeated full reviews of the SAME
 * head reuse the scan row and replace its AI-review findings, so the thread's
 * original finding row is gone. The thread keeps its finding's identity on
 * its own row (hashes only); with no identity at all it is never addressed.
 */
describe('LUM-1127 follow-up #2 — thread identity kept on the row', () => {
  const FILE = 'src/probe/session.ts'
  const dataRow = (over: Partial<FindingThreadRow> = {}) =>
    row({
      fingerprint: 'fp-data',
      ruleId: 'review:data_integrity',
      kind: 'CORRECTNESS',
      filePath: FILE,
      ...threadIdentityOf(
        {
          ruleId: 'review:data_integrity',
          line: 30,
          severity: 'MEDIUM',
          title:
            'parseQuantity returns unvalidated JSON.parse result typed as number',
        },
        'return JSON.parse(raw)',
        KEY
      ),
      ...over,
    })
  const logicFinding = (over: Partial<ReviewFindingRow> = {}) =>
    finding({
      fingerprint: 'fp-logic',
      ruleId: 'review:logic_error',
      kind: 'CORRECTNESS',
      severity: 'MEDIUM',
      filePath: FILE,
      line: 31,
      title: 'parseQuantity returns unvalidated JSON.parse result',
      ...over,
    })
  const logicIdentity = {
    fingerprint: 'fp-logic',
    ruleId: 'review:logic_error',
    provenance: 'LLM_JUDGE' as const,
    filePath: FILE,
    line: 31,
    title: 'parseQuantity returns unvalidated JSON.parse result',
    severity: 'MEDIUM' as const,
    evidence: '  return JSON.parse(raw) as number',
  }

  it('threadIdentityOf keeps hashes only — no title or code text', () => {
    const id = threadIdentityOf(
      {
        ruleId: 'review:logic_error',
        line: 31,
        severity: 'MEDIUM',
        title: 'parseQuantity returns unvalidated JSON.parse result',
      },
      'return JSON.parse(raw)',
      KEY
    )
    const text = JSON.stringify(id)
    expect(text).not.toMatch(/parseQuantity|JSON\.parse|raw/)
    expect(id.identityEvidenceHash).toMatch(/^[0-9a-f]{8}\.[0-9a-f]{32}$/)
    expect(id.identityTitleTokens.length).toBeGreaterThan(0)
  })

  it('storedIdentityOf: null until recorded', () => {
    expect(storedIdentityOf(row(), KEY)).toBeNull()
    expect(storedIdentityOf(dataRow(), KEY)).toEqual(
      expect.objectContaining({
        fingerprint: 'fp-data',
        ruleId: 'review:data_integrity',
        line: 30,
        severity: 'MEDIUM',
      })
    )
  })

  it("reconcile: the finding row is gone (same-head re-review) — the row's own identity carries the thread", async () => {
    repoMock.findByPullRequest.mockResolvedValue([dataRow()])
    // The scan's earlier rows were replaced: only the current finding reads back.
    repoMock.findIdentitiesByFingerprints.mockResolvedValue([logicIdentity])
    const f = logicFinding()
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(repoMock.findIdentitiesByFingerprints).toHaveBeenCalledWith('pr1', [
      'fp-logic',
    ])
    expect(threads.resolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    expect(out.carried).toEqual(new Map([['fp-logic', 'fp-data']]))
    // The row now stands for the relabelled finding (severity kept).
    expect(repoMock.update).toHaveBeenCalledWith('t1', {
      aliasFingerprints: ['fp-logic'],
      ...threadIdentityOf(f, logicIdentity.evidence, KEY),
      identitySeverity: 'MEDIUM',
    })
  })

  it('reconcile: no identity anywhere ⇒ NOT addressed, logged (fail safe)', async () => {
    repoMock.findByPullRequest.mockResolvedValue([
      row({ fingerprint: 'fp-gone', filePath: FILE }),
    ])
    repoMock.findIdentitiesByFingerprints.mockResolvedValue([logicIdentity])
    const f = logicFinding({ line: 90, title: 'Unrelated', ruleId: 'x:y' })
    const out = await prFindingThreadService.reconcile(
      ctx({ findings: [f], open: [f] })
    )
    expect(threads.resolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    expect(out.counts).toEqual({ open: 1, addressed: 0, resolved: 0 })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/identity unknown fp=fp-gone/)
    )
  })

  it('unknown identity but no AI-layer finding left in its file ⇒ addressed (no successor possible)', () => {
    const elsewhere = logicFinding({ filePath: 'lib/other.ts' })
    const plan = planThreadActions({
      rows: [row({ fingerprint: 'fp-gone', filePath: FILE })],
      findings: [elsewhere],
      open: [elsewhere],
      scan: COMPLETE,
      headSha: HEAD,
      remote: null,
      identities: new Map(),
    })
    expect(plan.unknownIdentity).toEqual([])
    expect(plan.actions).toEqual([expect.objectContaining({ kind: 'ADDRESS' })])
  })

  it('planThreadActions: an unknown identity is reported, not addressed; a known one with no successor is', () => {
    const plan = planThreadActions({
      rows: [
        row({ fingerprint: 'fp-gone', filePath: FILE }),
        dataRow({ id: 't2' }),
      ],
      // A different issue in the same file: no match for fp-data, but it
      // could be fp-gone's relabel — unknown, so held.
      findings: [logicFinding({ line: 90, title: 'Unrelated', ruleId: 'x:y' })],
      open: [],
      scan: COMPLETE,
      headSha: HEAD,
      remote: null,
      identities: new Map([['fp-data', storedIdentityOf(dataRow(), KEY)!]]),
    })
    expect(plan.unknownIdentity.map(r => r.fingerprint)).toEqual(['fp-gone'])
    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'ADDRESS',
        row: expect.objectContaining({ fingerprint: 'fp-data' }),
      }),
    ])
  })

  it('planIdentityWrites: records a reported row with no identity yet; skips it when the evidence read failed', () => {
    const f = finding()
    const ids = new Map([
      [
        'fp1',
        {
          fingerprint: 'fp1',
          ruleId: f.ruleId,
          provenance: 'LLM_JUDGE' as const,
          filePath: f.filePath,
          line: 12,
          title: f.title,
          evidence: 'db.query(sql)',
        },
      ],
    ])
    expect(
      planIdentityWrites({
        rows: [row()],
        findings: [f],
        identities: ids,
        carried: [],
        key: KEY,
      })
    ).toEqual([
      { row: row(), patch: threadIdentityOf(f, 'db.query(sql)', KEY) },
    ])
    expect(
      planIdentityWrites({
        rows: [row()],
        findings: [f],
        identities: null,
        carried: [],
        key: KEY,
      })
    ).toEqual([])
  })

  it('planIdentityWrites: refreshes a moved line, keeps the evidence hash; nothing when unchanged', () => {
    const recorded = dataRow()
    const same = finding({
      fingerprint: 'fp-data',
      ruleId: 'review:data_integrity',
      severity: 'MEDIUM',
      filePath: FILE,
      line: 30,
      title:
        'parseQuantity returns unvalidated JSON.parse result typed as number',
    })
    expect(
      planIdentityWrites({
        rows: [recorded],
        findings: [same],
        identities: new Map(),
        carried: [],
        key: KEY,
      })
    ).toEqual([])
    const writes = planIdentityWrites({
      rows: [recorded],
      findings: [{ ...same, line: 34 }],
      identities: new Map(),
      carried: [],
      key: KEY,
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.patch).toEqual(
      expect.objectContaining({ identityLine: 34 })
    )
    expect(writes[0]!.patch).not.toHaveProperty('identityEvidenceHash')
  })

  it("recordPosted stores the posted AI-layer finding's identity (hashes)", async () => {
    const f = logicFinding()
    repoMock.findIdentitiesByFingerprints.mockResolvedValue([logicIdentity])
    ;(
      prCommentClient.listReviewCommentsOfReview as jest.Mock
    ).mockResolvedValue([
      {
        id: 303,
        body: 'x\n\n<!-- lumo-security:fp:fp-logic -->',
        user: { type: 'Bot' },
      },
    ])
    await prFindingThreadService.recordPosted(ctx(), 9, [f], new Map())
    expect(repoMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: 'fp-logic',
        commentId: '303',
        ...threadIdentityOf(f, logicIdentity.evidence, KEY),
      })
    )
  })

  it('recordPosted: evidence read failed ⇒ the row is still recorded, identity left for a later sync', async () => {
    const f = logicFinding()
    repoMock.findIdentitiesByFingerprints.mockRejectedValue(new Error('db'))
    ;(
      prCommentClient.listReviewCommentsOfReview as jest.Mock
    ).mockResolvedValue([
      {
        id: 303,
        body: 'x\n\n<!-- lumo-security:fp:fp-logic -->',
        user: { type: 'Bot' },
      },
    ])
    await prFindingThreadService.recordPosted(ctx(), 9, [f], new Map())
    expect(repoMock.upsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ identityRuleId: expect.anything() })
    )
    expect(repoMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: 'fp-logic', commentId: '303' })
    )
  })
})

describe('LUM-1127 follow-up #2 — the identity key', () => {
  it('findingIdentityKey: dedicated key, else CRON_SECRET, else null', () => {
    expect(
      findingIdentityKey({ LUMO_FINDING_IDENTITY_KEY: 'a', CRON_SECRET: 'b' })
    ).toBe('a')
    expect(findingIdentityKey({ CRON_SECRET: 'b' })).toBe('b')
    expect(findingIdentityKey({})).toBeNull()
  })

  it('a row hashed with another key reads as unknown (never as a mismatch) and is re-recorded', () => {
    const f = finding()
    const old = row({
      ...threadIdentityOf(f, 'db.query(sql)', 'rotated-away'),
    })
    expect(storedIdentityOf(old, KEY)).toBeNull()
    const writes = planIdentityWrites({
      rows: [old],
      findings: [f],
      identities: new Map([
        [
          'fp1',
          {
            fingerprint: 'fp1',
            ruleId: f.ruleId,
            provenance: 'LLM_JUDGE' as const,
            filePath: f.filePath,
            line: f.line,
            title: f.title,
            evidence: 'db.query(sql)',
          },
        ],
      ]),
      carried: [],
      key: KEY,
    })
    expect(writes).toEqual([
      { row: old, patch: threadIdentityOf(f, 'db.query(sql)', KEY) },
    ])
  })

  it('no key configured ⇒ nothing recorded at post time', async () => {
    delete process.env.LUMO_FINDING_IDENTITY_KEY
    const OLD_CRON = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    try {
      ;(
        prCommentClient.listReviewCommentsOfReview as jest.Mock
      ).mockResolvedValue([
        {
          id: 404,
          body: 'x\n\n<!-- lumo-security:fp:fp1 -->',
          user: { type: 'Bot' },
        },
      ])
      await prFindingThreadService.recordPosted(
        ctx(),
        9,
        [finding()],
        new Map()
      )
      expect(repoMock.upsert).toHaveBeenCalledWith(
        expect.not.objectContaining({ identityRuleId: expect.anything() })
      )
      expect(repoMock.findIdentitiesByFingerprints).not.toHaveBeenCalled()
    } finally {
      if (OLD_CRON !== undefined) process.env.CRON_SECRET = OLD_CRON
    }
  })
})
