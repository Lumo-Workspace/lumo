/**
 * @jest-environment node
 *
 * LUM-1127 follow-up #3 — production TC13 (probe PR 64, one scan row, head
 * 4cb6b57): r2 relabelled the parseQuantity issue (`review:logic_error` →
 * `review:api_misuse`) and the thread was carried — but only in that sync's
 * memory. In r3 a write-back running mid-review (scan RUNNING, r2's findings
 * still on the row) planned no carry and posted the relabelled finding as a
 * NEW thread; later relabels then marked one thread "Addressed" and the
 * other "Reappeared" on the same head.
 *
 * Here the write-back is replayed against stateful fakes of the thread table
 * and GitHub: the carry must be kept on the row, so no sync — mid-review or
 * not — posts a second thread, nothing is addressed until a fix push, and a
 * duplicate already in production is merged (older kept, newer resolved as a
 * duplicate, no "Addressed").
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createReviewLineReply: jest.fn(),
      listReviewCommentsOfReview: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {
    listReviewThreads: jest.fn(),
    resolveThread: jest.fn(),
    unresolveThread: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn(),
    findByThreadRef: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findLayerMetaByFingerprints: jest.fn().mockResolvedValue([]),
    findIdentitiesByFingerprints: jest.fn(),
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
  planAliasCarries,
  planDuplicateMerges,
  prFindingThreadService,
  resolveThreadsByCommand,
  threadIdentityOf,
  withAlias,
  type ThreadSyncContext,
} from '@/ee/security/services/pr-finding-thread.service'
import { threadFingerprints } from '@/ee/security/security-scan/thread-fingerprints'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import {
  reviewThreadClient,
  type ReviewThreadState,
} from '@/lib/integrations/github/review-threads'
import {
  prFindingThreadRepository,
  type FindingThreadRow,
  type FindingThreadUpsert,
  type FindingThreadPatch,
  type FindingIdentityRow,
} from '@/ee/security/repositories/pr-finding-thread.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'

const repo = prFindingThreadRepository as jest.Mocked<
  typeof prFindingThreadRepository
>
const gh = reviewThreadClient as jest.Mocked<typeof reviewThreadClient>
const comments = prCommentClient as jest.Mocked<typeof prCommentClient>

const HEAD = '4cb6b57aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const FIX = '2576299bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const FILE = 'src/probe/order.ts'
const EVIDENCE = '  return JSON.parse(raw) as number'
const BOT = { type: 'Bot', login: 'uselumo[bot]' }

const OLD_KEY = process.env.LUMO_FINDING_IDENTITY_KEY
afterAll(() => {
  if (OLD_KEY === undefined) delete process.env.LUMO_FINDING_IDENTITY_KEY
  else process.env.LUMO_FINDING_IDENTITY_KEY = OLD_KEY
})

function finding(over: Partial<ReviewFindingRow>): ReviewFindingRow {
  return {
    id: over.fingerprint ?? 'f',
    kind: 'CORRECTNESS',
    ruleId: 'review:logic_error',
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath: FILE,
    line: 13,
    title:
      'parseQuantity returns unvalidated JSON.parse result typed as number',
    detail: 'd',
    fingerprint: 'a47a1d46c59c856e',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

// The two labels the AI review alternated between on the same head.
const LOGIC = finding({})
const API = finding({
  fingerprint: 'e55e1f153e9fe33e',
  ruleId: 'review:api_misuse',
  title: 'JSON.parse result returned unvalidated as number',
})
const API_AGAIN = {
  ...API,
  title: 'JSON.parse result returned as number without validation',
}

const COMPLETE = {
  status: 'FINDINGS' as const,
  stages: {
    secrets: 'RAN',
    external: 'RAN',
    judge: 'RAN',
    hunt: 'RAN',
    supplyChain: 'RAN',
  } as const,
  judgeReviewScope: null,
}
// A full re-review in flight: the row still holds the previous pass.
const RUNNING = {
  status: 'RUNNING' as const,
  stages: {
    secrets: 'RAN',
    external: 'RAN',
    judge: 'PENDING',
    hunt: 'PENDING',
    supplyChain: 'RAN',
  } as const,
  judgeReviewScope: null,
}

// ── Stateful fakes: the thread table and GitHub ────────────────────────────

interface Comment {
  id: number
  body: string
  user: typeof BOT
  in_reply_to_id?: number | null
}
let rows: FindingThreadRow[]
let ghComments: Comment[] // newest first, like the listing
let ghThreads: Map<string, ReviewThreadState>
let replies: Array<{ inReplyTo: number; body: string }>
let nextId: number

function threadOf(threadId: string): ReviewThreadState {
  const t = [...ghThreads.values()].find(x => x.id === threadId)
  if (!t) throw new Error(`no thread ${threadId}`)
  return t
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_FINDING_IDENTITY_KEY = 'tc13-key'
  rows = []
  ghComments = []
  ghThreads = new Map()
  replies = []
  nextId = 4286418621

  repo.findByPullRequest.mockImplementation(async () =>
    rows.map(r => ({
      ...r,
      aliasFingerprints: [...(r.aliasFingerprints ?? [])],
    }))
  )
  repo.update.mockImplementation(
    async (id: string, patch: FindingThreadPatch) => {
      const r = rows.find(x => x.id === id)
      if (!r) throw new Error(`no row ${id}`)
      Object.assign(r, patch)
    }
  )
  repo.delete.mockImplementation(async (id: string) => {
    rows = rows.filter(r => r.id !== id)
  })
  repo.upsert.mockImplementation(async (u: FindingThreadUpsert) => {
    const r = rows.find(x => x.fingerprint === u.fingerprint)
    if (r) {
      Object.assign(r, {
        commentId: u.commentId,
        threadNodeId: u.threadNodeId ?? null,
        state: u.state ?? 'OPEN',
        addressedInSha: null,
      })
      return
    }
    rows.push({
      id: `t${rows.length + 1}`,
      pullRequestId: u.pullRequestId,
      fingerprint: u.fingerprint,
      commentId: u.commentId,
      threadNodeId: u.threadNodeId ?? null,
      state: u.state ?? 'OPEN',
      ruleId: u.ruleId,
      provenance: u.provenance,
      kind: u.kind,
      filePath: u.filePath,
      resolvedByLogin: u.resolvedByLogin ?? null,
      addressedInSha: null,
      identityRuleId: u.identityRuleId ?? null,
      identityLine: u.identityLine ?? null,
      identitySeverity: u.identitySeverity ?? null,
      identityEvidenceHash: u.identityEvidenceHash ?? null,
      identityTitleTokens: u.identityTitleTokens ?? [],
      aliasFingerprints: [],
    })
  })
  // A full re-review replaces the scan's finding rows: only what the
  // current scan reports reads back.
  repo.findIdentitiesByFingerprints.mockImplementation(async () => [])

  gh.listReviewThreads.mockImplementation(async () =>
    [...ghThreads.values()].map(t => ({ ...t }))
  )
  gh.resolveThread.mockImplementation(async ({ threadId }) => {
    Object.assign(threadOf(threadId), {
      isResolved: true,
      resolvedBy: { login: 'uselumo[bot]', type: 'User' },
    })
  })
  gh.unresolveThread.mockImplementation(async ({ threadId }) => {
    Object.assign(threadOf(threadId), { isResolved: false, resolvedBy: null })
  })
  comments.createReviewLineReply.mockImplementation(async input => {
    replies.push({ inReplyTo: input.inReplyTo, body: input.body })
    return { id: nextId++ } as never
  })
})

function identitiesOf(findings: ReviewFindingRow[]): FindingIdentityRow[] {
  return findings.map(f => ({
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    provenance: f.provenance,
    filePath: f.filePath,
    line: f.line,
    title: f.title,
    severity: f.severity,
    evidence: EVIDENCE,
  }))
}

const marker = (fp: string) => `<!-- lumo-security:fp:${fp} -->`
const markerFp = (body: string) =>
  /<!--\s*lumo-security:fp:([^\s>]+?)\s*-->/.exec(body)?.[1] ?? null

/**
 * One PR write-back as `security-pr-review.service` runs it: reconcile the
 * threads, post every inline finding that has no thread yet, record them.
 */
async function writeBack(
  scan: ThreadSyncContext['scan'],
  findings: ReviewFindingRow[],
  headSha = HEAD,
  isBlocking?: (f: ReviewFindingRow) => boolean
): Promise<string[]> {
  repo.findIdentitiesByFingerprints.mockImplementation(async (_pr, fps) =>
    identitiesOf(findings).filter(i => fps.includes(i.fingerprint))
  )
  const ctx: ThreadSyncContext = {
    pullRequestId: 'pr64',
    workspaceId: 'w1',
    repo: { owner: 'Lumo-Workspace', name: 'lumo-agent-test' },
    prNumber: 64,
    token: 'tok',
    headSha,
    scan,
    findings,
    open: findings,
    comments: ghComments.map(c => ({ ...c })) as never,
    ...(isBlocking ? { isBlocking } : {}),
  }
  const threads = await prFindingThreadService.reconcile(ctx)
  const existing = new Set(
    ghComments.map(c => markerFp(c.body)).filter((x): x is string => !!x)
  )
  for (const fp of threads.resolvedByUser) existing.add(fp)
  for (const fp of threads.repost.keys()) existing.delete(fp)
  for (const fp of threads.carried.keys()) existing.add(fp)
  const toPost = findings.filter(
    f => f.line !== null && f.severity !== 'LOW' && !existing.has(f.fingerprint)
  )
  if (toPost.length === 0) return []
  const posted = toPost.map(f => {
    const id = nextId++
    const c = {
      id,
      body: `**${f.title}**\n\n${marker(f.fingerprint)}`,
      user: BOT,
    }
    ghComments.unshift(c)
    ghThreads.set(String(id), {
      id: `PRRT_${id}`,
      isResolved: false,
      isOutdated: false,
      resolvedBy: null,
      firstCommentId: id,
    })
    return c
  })
  comments.listReviewCommentsOfReview.mockResolvedValueOnce(posted as never)
  await prFindingThreadService.recordPosted(ctx, 1, toPost, threads.repost)
  return toPost.map(f => f.fingerprint)
}

const notes = () => replies.map(r => `${r.inReplyTo}:${r.body.split(' —')[0]}`)

describe('TC13 replay — one scan row, repeated full reviews on the same head', () => {
  it('r1→r4 with a mid-review sync keep ONE thread; only the fix push addresses it', async () => {
    // r1: the issue is posted once.
    expect(await writeBack(COMPLETE, [LOGIC])).toEqual([LOGIC.fingerprint])
    const original = ghComments[0]!.id

    // r2: relabelled → carried.
    expect(await writeBack(COMPLETE, [API])).toEqual([])

    // r3, ~35 s in: the scan is RUNNING and still holds r2's findings.
    // Production posted the relabelled finding as a second thread here.
    expect(await writeBack(RUNNING, [API])).toEqual([])
    // …because the carry was never kept: now it is, on the one row.
    expect(rows).toHaveLength(1)
    expect(threadFingerprints(rows[0]!)).toEqual([
      LOGIC.fingerprint,
      API.fingerprint,
    ])

    // r3 done: relabelled back. r4 done: relabelled again.
    expect(await writeBack(COMPLETE, [LOGIC])).toEqual([])
    expect(await writeBack(RUNNING, [LOGIC])).toEqual([])
    expect(await writeBack(COMPLETE, [API_AGAIN])).toEqual([])

    // One thread, still open, no note of any kind on the same head.
    expect(ghComments.map(c => c.id)).toEqual([original])
    expect(replies).toEqual([])
    expect(gh.resolveThread).not.toHaveBeenCalled()
    expect(rows).toEqual([
      expect.objectContaining({ commentId: String(original), state: 'OPEN' }),
    ])

    // The fix push: a complete review no longer reports it → addressed once.
    expect(await writeBack(COMPLETE, [], FIX)).toEqual([])
    expect(notes()).toEqual([`${original}:✅ Addressed in \`2576299\``])
    expect(rows[0]).toEqual(
      expect.objectContaining({ state: 'ADDRESSED', addressedInSha: FIX })
    )
  })

  it('a carry made mid-review (not kept by an older sync) still posts nothing and addresses nothing', async () => {
    await writeBack(COMPLETE, [LOGIC])
    // A row carried before this fix kept nothing: drop the alias.
    rows[0]!.aliasFingerprints = []
    // The relabelled finding is on the row while the review is in flight.
    expect(await writeBack(RUNNING, [API])).toEqual([])
    expect(replies).toEqual([])
    expect(rows[0]!.aliasFingerprints).toEqual([API.fingerprint])
  })
})

describe('a duplicate already in production is merged on the next sync', () => {
  // The state the bug left behind: thread A for the original label, thread
  // B posted mid-review for the relabelled one, both open.
  async function seedDuplicate(): Promise<{ a: number; b: number }> {
    await writeBack(COMPLETE, [LOGIC])
    rows[0]!.aliasFingerprints = []
    // The old write-back: no carry → the relabelled finding got its own thread.
    const [b] = await (async () => {
      const id = nextId++
      ghComments.unshift({ id, body: marker(API.fingerprint), user: BOT })
      ghThreads.set(String(id), {
        id: `PRRT_${id}`,
        isResolved: false,
        isOutdated: false,
        resolvedBy: null,
        firstCommentId: id,
      })
      rows.push({
        ...rows[0]!,
        id: 't2',
        fingerprint: API.fingerprint,
        ruleId: API.ruleId,
        commentId: String(id),
        threadNodeId: `PRRT_${id}`,
        aliasFingerprints: [],
        ...threadIdentityOf(API, EVIDENCE, 'tc13-key'),
      })
      return [id]
    })()
    return { a: Number(rows[0]!.commentId), b: b! }
  }

  it('the original label is reported: B (newer) is resolved as a duplicate of A — no "Addressed"', async () => {
    const { a, b } = await seedDuplicate()
    expect(await writeBack(COMPLETE, [LOGIC])).toEqual([])
    expect(replies).toHaveLength(1)
    expect(replies[0]!.inReplyTo).toBe(b)
    expect(replies[0]!.body).toMatch(/^🔗 Duplicate/)
    expect(replies[0]!.body).toContain(
      `https://github.com/Lumo-Workspace/lumo-agent-test/pull/64#discussion_r${a}`
    )
    expect(replies[0]!.body).not.toMatch(/Addressed/)
    expect(ghThreads.get(String(b))!.isResolved).toBe(true)
    expect(ghThreads.get(String(a))!.isResolved).toBe(false)
    expect(rows).toEqual([
      expect.objectContaining({
        commentId: String(a),
        state: 'OPEN',
        aliasFingerprints: [API.fingerprint],
      }),
    ])
    // Later relabels stay on A; nothing is re-posted or re-adopted.
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    expect(await writeBack(COMPLETE, [LOGIC])).toEqual([])
    expect(replies).toHaveLength(1)
    expect(rows).toHaveLength(1)
  })

  it('the relabelled one is reported: still the older thread A keeps the issue', async () => {
    const { a, b } = await seedDuplicate()
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    expect(replies.map(r => r.inReplyTo)).toEqual([b])
    expect(rows).toEqual([
      expect.objectContaining({
        commentId: String(a),
        state: 'OPEN',
        aliasFingerprints: [API.fingerprint],
      }),
    ])
  })

  it('a GitHub failure addresses nothing; the merge is kept pending and finished on the next sync', async () => {
    const { a, b } = await seedDuplicate()
    gh.resolveThread.mockRejectedValueOnce(new Error('502'))
    expect(await writeBack(COMPLETE, [LOGIC])).toEqual([])
    expect(replies).toEqual([])
    expect(repo.delete).not.toHaveBeenCalled()
    // The decision is kept: A already owns B's fingerprint.
    expect(
      rows.find(r => r.commentId === String(a))!.aliasFingerprints
    ).toEqual([API.fingerprint])
    // Next sync — even with B's finding reported now — finishes the merge.
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    expect(replies.map(r => r.inReplyTo)).toEqual([b])
    expect(replies[0]!.body).toMatch(/^🔗 Duplicate/)
    expect(rows).toEqual([
      expect.objectContaining({ commentId: String(a), state: 'OPEN' }),
    ])
  })

  it('a merge interrupted after the thread was closed (row delete failed) is retried until the row is gone — one owner meanwhile', async () => {
    const { a, b } = await seedDuplicate()
    repo.delete.mockRejectedValueOnce(new Error('db down'))
    expect(await writeBack(COMPLETE, [LOGIC])).toEqual([])
    expect(rows).toHaveLength(2)
    // Both rows now name e55e…: the next sync, with e55e… reported (so
    // neither thread looks gone), finishes the merge.
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    expect(rows).toHaveLength(1)
    for (const findings of [[API], [LOGIC]]) {
      expect(await writeBack(COMPLETE, findings)).toEqual([])
    }
    expect(rows).toEqual([
      expect.objectContaining({
        commentId: String(a),
        state: 'OPEN',
        aliasFingerprints: [API.fingerprint],
      }),
    ])
    // One duplicate note on B, nothing else anywhere.
    expect(replies.map(r => r.inReplyTo)).toEqual([b])
  })

  it('a merged duplicate a human unresolves is not adopted back by the webhook', async () => {
    const { b } = await seedDuplicate()
    await writeBack(COMPLETE, [LOGIC])
    repo.findByThreadRef.mockResolvedValue([])
    await expect(
      applyReviewThreadEvent({
        workspaceId: 'w1',
        pullRequestId: 'pr64',
        action: 'unresolved',
        threadNodeId: `PRRT_${b}`,
        comments: [{ id: b, body: marker(API.fingerprint), user: BOT }],
        sender: { login: 'alice', type: 'User' },
      })
    ).resolves.toBe('unchanged')
    expect(repo.upsert).toHaveBeenCalledTimes(1) // r1's post only
  })
})

describe('webhook adoption guard', () => {
  it("a marker comment of a fingerprint that is a thread's OWN (not an alias) is still adopted", async () => {
    await writeBack(COMPLETE, [LOGIC])
    repo.findByThreadRef.mockResolvedValue([])
    repo.findLayerMetaByFingerprints.mockResolvedValueOnce([
      {
        fingerprint: LOGIC.fingerprint,
        ruleId: LOGIC.ruleId,
        provenance: LOGIC.provenance,
        kind: LOGIC.kind,
        filePath: LOGIC.filePath,
      },
    ])
    await expect(
      applyReviewThreadEvent({
        workspaceId: 'w1',
        pullRequestId: 'pr64',
        action: 'resolved',
        threadNodeId: 'PRRT_older',
        comments: [{ id: 17, body: marker(LOGIC.fingerprint), user: BOT }],
        sender: { login: 'alice', type: 'User' },
      })
    ).resolves.toBe('recorded')
  })
})

describe('a carried fingerprint follows the carry rules of its thread state', () => {
  // r1 posts LOGIC; a human resolves the thread on GitHub.
  async function resolvedByHuman(): Promise<number> {
    await writeBack(COMPLETE, [LOGIC])
    const id = ghComments[0]!.id
    Object.assign(ghThreads.get(String(id))!, {
      isResolved: true,
      resolvedBy: { login: 'alice', type: 'User' },
    })
    return id
  }

  it('resolved by a human, relabelled at the same severity: stays on the resolved thread (no comment, no reply)', async () => {
    await resolvedByHuman()
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    expect(replies).toEqual([])
    expect(rows).toEqual([
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        aliasFingerprints: [API.fingerprint],
      }),
    ])
  })

  it('resolved by a human, the carried finding later reported MORE severe: posted afresh', async () => {
    await resolvedByHuman()
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    const worse = { ...API, severity: 'HIGH' as const }
    expect(await writeBack(COMPLETE, [worse])).toEqual([API.fingerprint])
    // The new comment owns its own thread; the resolved one lets go of it.
    expect(rows).toEqual([
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        aliasFingerprints: [],
      }),
      expect.objectContaining({ fingerprint: API.fingerprint, state: 'OPEN' }),
    ])
    // …and stays a single thread on the next sync.
    expect(await writeBack(COMPLETE, [worse])).toEqual([])
    expect(rows).toHaveLength(2)
  })

  it('resolved by a human, the carried finding now blocks DONE: posted afresh', async () => {
    await resolvedByHuman()
    expect(await writeBack(COMPLETE, [API])).toEqual([])
    const blocks = (f: ReviewFindingRow) => f.fingerprint === API.fingerprint
    expect(await writeBack(COMPLETE, [API], HEAD, blocks)).toEqual([
      API.fingerprint,
    ])
  })

  it('addressed, then reported again under the carried fingerprint: a regression on the same thread', async () => {
    await writeBack(COMPLETE, [LOGIC])
    const id = ghComments[0]!.id
    await writeBack(COMPLETE, [API])
    await writeBack(COMPLETE, [], FIX)
    expect(rows[0]!.state).toBe('ADDRESSED')
    expect(await writeBack(COMPLETE, [API], 'd00d' + FIX.slice(4))).toEqual([])
    expect(notes()).toEqual([
      `${id}:✅ Addressed in \`2576299\``,
      `${id}:⚠️ Reappeared in \`d00d299\``,
    ])
    expect(ghThreads.get(String(id))!.isResolved).toBe(false)
    expect(rows[0]!.state).toBe('OPEN')
  })
})

describe('`@app resolve` honours the carried fingerprint', () => {
  it('a thread carried to a finding that blocks DONE is left open', async () => {
    await writeBack(COMPLETE, [LOGIC])
    await writeBack(COMPLETE, [API])
    const out = await resolveThreadsByCommand({
      pullRequestId: 'pr64',
      repo: { owner: 'Lumo-Workspace', name: 'lumo-agent-test' },
      prNumber: 64,
      token: 'tok',
      login: 'alice',
      keep: new Set([API.fingerprint]),
    })
    expect(out).toEqual({ resolved: 0, kept: 1, failed: 0 })
    expect(gh.resolveThread).not.toHaveBeenCalled()
  })
})

describe('pure helpers', () => {
  const base: FindingThreadRow = {
    id: 't1',
    pullRequestId: 'pr',
    fingerprint: 'fp-a',
    commentId: '10',
    threadNodeId: 'T10',
    state: 'OPEN',
    ruleId: 'review:logic_error',
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    filePath: FILE,
    resolvedByLogin: null,
    addressedInSha: null,
  }

  it('planAliasCarries: open / addressed carry; resolved carries only under the carry rule; reposted and unreported skipped', () => {
    const r = (id: string, fp: string, state: FindingThreadRow['state']) => ({
      ...base,
      id,
      fingerprint: fp,
      state,
      identitySeverity: 'MEDIUM' as const,
      aliasFingerprints: [`${fp}-x`, `${fp}-y`],
    })
    const rowsIn = [
      r('o', 'open', 'OPEN'),
      r('a', 'addr', 'ADDRESSED'),
      r('h', 'human', 'RESOLVED_BY_USER'),
      r('b', 'block', 'RESOLVED_BY_USER'),
    ]
    const f = (fp: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM') =>
      finding({ fingerprint: fp, severity })
    const out = planAliasCarries({
      rows: rowsIn,
      findings: [
        f('open-x'),
        f('open-y'),
        f('addr-x'),
        f('human-x', 'LOW'),
        f('human-y', 'HIGH'),
        f('block-x'),
      ],
      state: new Map(rowsIn.map(x => [x.fingerprint, x.state])),
      reposted: new Set(['open-y']),
      identities: null,
      isBlocking: x => x.fingerprint === 'block-x',
    })
    expect(Object.fromEntries(out.carried)).toEqual({
      'open-x': 'open',
      'addr-x': 'addr',
      'human-x': 'human',
    })
    expect(out.detach.map(d => [d.row.id, d.aliases])).toEqual([
      ['h', ['human-x']],
      ['b', ['block-y']],
    ])
  })

  it('withAlias appends once and never the own fingerprint', () => {
    expect(withAlias(base, 'fp-b')).toEqual(['fp-b'])
    expect(withAlias({ ...base, aliasFingerprints: ['fp-b'] }, 'fp-b')).toEqual(
      ['fp-b']
    )
    expect(withAlias(base, 'fp-a')).toEqual([])
  })

  it("planDuplicateMerges: a row whose fingerprint is another thread's alias is a pending merge into it — whatever is reported", () => {
    const keep = { ...base, aliasFingerprints: ['fp-b'] }
    const drop = { ...base, id: 't2', commentId: '5', fingerprint: 'fp-b' }
    const input = {
      rows: [drop, keep],
      findings: [],
      open: [],
      scan: COMPLETE,
      headSha: HEAD,
      remote: null,
    }
    for (const identities of [null, new Map()])
      expect(
        planDuplicateMerges({ ...input, identities }).map(m => [
          m.keep.id,
          m.drop.id,
        ])
      ).toEqual([['t1', 't2']])
  })

  it('planDuplicateMerges: nothing without identities, nothing for two distinct issues', () => {
    const rowsIn = [
      { ...base, fingerprint: LOGIC.fingerprint },
      { ...base, id: 't2', commentId: '20', fingerprint: API.fingerprint },
    ]
    const input = {
      rows: rowsIn,
      findings: [LOGIC],
      open: [LOGIC],
      scan: COMPLETE,
      headSha: HEAD,
      remote: null,
    }
    expect(planDuplicateMerges({ ...input, identities: null })).toEqual([])
    const ids = new Map(identitiesOf([LOGIC, API]).map(i => [i.fingerprint, i]))
    expect(
      planDuplicateMerges({ ...input, identities: ids }).map(m => [
        m.keep.id,
        m.drop.id,
      ])
    ).toEqual([['t1', 't2']])
    const other = {
      ...ids.get(API.fingerprint)!,
      line: 40,
      title: 'Discount codes are compared case-sensitively',
      evidence: 'return DISCOUNTS[code]',
    }
    expect(
      planDuplicateMerges({
        ...input,
        identities: new Map([...ids, [API.fingerprint, other]]),
      })
    ).toEqual([])
  })
})
