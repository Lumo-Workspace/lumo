/**
 * @jest-environment node
 *
 * LUM-1127 — Lumo's inline finding threads across pushes (CodeRabbit parity):
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
  planThreadActions,
  prFindingThreadService,
  type ThreadSyncContext,
} from '@/ee/security/services/pr-finding-thread.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
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
  threads.listReviewThreads.mockResolvedValue([remote()])
  repoMock.findByPullRequest.mockResolvedValue([row()])
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
  })
})
