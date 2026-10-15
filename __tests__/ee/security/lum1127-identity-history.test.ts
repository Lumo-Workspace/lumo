/**
 * @jest-environment node
 *
 * LUM-1127 follow-up #4 — production (LUM-1200 TC12, probe lumo-agent-test
 * PR 67, one scan row, head ee540f0): four full AI reviews of the same head
 * reported one issue at `src/server.ts:31` as
 *
 *   r1 review:logic_error  "Session check route does not restrict method and prefix matching is loose"
 *   r2 review:logic_error  "Token in query string and route matching by prefix"        (same fingerprint)
 *   r3 review:api_misuse   "Session check route ignores method and uses prefix match"   (new fingerprint)
 *   r4 review:logic_error  "/session/check ignores HTTP method and prefix match is loose" (r1's fingerprint)
 *
 * r2 overwrote the thread's stored identity with its own wording, so r3 was
 * compared with r2 only (two shared words, different class): the thread was
 * marked "✅ Addressed" and a second thread opened on the same line; r4 then
 * flipped them ("⚠️ Reappeared" / "✅ Addressed") on an unchanged head.
 *
 * Replayed against stateful fakes of the thread table and GitHub, with the
 * real reconcile / recordPosted.
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
  mergedHistory,
  planThreadActions,
  prFindingThreadService,
  storedIdentityOf,
  threadIdentityOf,
  type ThreadSyncContext,
} from '@/ee/security/services/pr-finding-thread.service'
import {
  IDENTITY_HISTORY_CAP,
  addIdentityVariant,
  sameIssueScore,
  hashIdentity,
  type FindingIdentity,
} from '@/ee/security/security-scan/finding-successor'
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
import { logger } from '@/lib/logger'

const repo = prFindingThreadRepository as jest.Mocked<
  typeof prFindingThreadRepository
>
const gh = reviewThreadClient as jest.Mocked<typeof reviewThreadClient>
const comments = prCommentClient as jest.Mocked<typeof prCommentClient>

const KEY = 'tc12-key'
const HEAD = 'ee540f06071c601973da9872c6e32fc875a309ff'
const FIX = '7f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c'
const SERVER = 'src/server.ts'
const STORE = 'src/services/session-store.ts'
const BOT = { type: 'Bot', login: 'uselumo[bot]' }

const OLD_KEY = process.env.LUMO_FINDING_IDENTITY_KEY
afterAll(() => {
  if (OLD_KEY === undefined) delete process.env.LUMO_FINDING_IDENTITY_KEY
  else process.env.LUMO_FINDING_IDENTITY_KEY = OLD_KEY
})

/** The quoted evidence line of each fingerprint. */
const evidence = new Map<string, string>()

function finding(
  over: Partial<ReviewFindingRow> & { fingerprint: string },
  quoted: string
): ReviewFindingRow {
  evidence.set(over.fingerprint, quoted)
  return {
    id: over.fingerprint,
    kind: 'CORRECTNESS',
    ruleId: 'review:logic_error',
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath: SERVER,
    line: 31,
    title: 't',
    detail: 'd',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

// ── The #67 snapshots (src/server.ts and the Math.random line) ─────────────

const ROUTE = "  if (req.url?.startsWith('/session/check')) {"
const LOGIC_FP = '5e1f0c31a7d2b9e4' // review:logic_error @ L31 (r1, r2, r4)
const API_FP = '9a04c7e2d18f3b65' // review:api_misuse @ L31 (r3)

const route = (
  ruleId: string,
  fingerprint: string,
  severity: 'LOW' | 'MEDIUM',
  title: string
) => finding({ fingerprint, ruleId, severity, line: 31, title }, ROUTE)

const AUTH = {
  39: "  if (req.method === 'POST' && req.url?.startsWith('/session')) {",
  40: "    const user = url.searchParams.get('user') ?? ''",
  41: '    const session = createSession(user)',
} as const
const authBypass = (line: 39 | 40 | 41, title: string) =>
  finding(
    {
      fingerprint: `auth${line}000000000000`,
      ruleId: 'vuln:auth_bypass',
      kind: 'VULNERABILITY',
      severity: 'HIGH',
      line,
      title,
    },
    AUTH[line]
  )
const weakCrypto = (title: string) =>
  finding(
    {
      fingerprint: '3be89b9bcac588d7',
      ruleId: 'vuln:weak_crypto',
      kind: 'VULNERABILITY',
      severity: 'HIGH',
      filePath: STORE,
      line: 10,
      title,
    },
    '  const token = Math.random().toString(36).slice(2)'
  )

const R1 = () => [
  weakCrypto('Session token generated with Math.random()'),
  authBypass(
    39,
    'Unauthenticated session creation for arbitrary user identity'
  ),
  route(
    'review:logic_error',
    LOGIC_FP,
    'MEDIUM',
    'Session check route does not restrict method and prefix matching is loose'
  ),
]
const R2 = () => [
  weakCrypto('Session tokens generated with Math.random()'),
  route(
    'review:logic_error',
    LOGIC_FP,
    'LOW',
    'Token in query string and route matching by prefix'
  ),
  authBypass(41, 'Unauthenticated session creation for arbitrary user'),
]
const R3 = () => [
  weakCrypto('Session token generated with Math.random()'),
  authBypass(39, 'Unauthenticated session creation for arbitrary user'),
  route(
    'review:api_misuse',
    API_FP,
    'MEDIUM',
    'Session check route ignores method and uses prefix match'
  ),
]
const R4 = () => [
  weakCrypto('Session tokens generated with Math.random()'),
  authBypass(40, 'Unauthenticated session creation for arbitrary user'),
  route(
    'review:logic_error',
    LOGIC_FP,
    'LOW',
    '/session/check ignores HTTP method and prefix match is loose'
  ),
]

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

const copyRow = (r: FindingThreadRow): FindingThreadRow => ({
  ...r,
  aliasFingerprints: [...(r.aliasFingerprints ?? [])],
  identityHistory: (r.identityHistory ?? []).map(v => ({ ...v })),
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_FINDING_IDENTITY_KEY = KEY
  evidence.clear()
  rows = []
  ghComments = []
  ghThreads = new Map()
  replies = []
  nextId = 4287935781

  repo.findByPullRequest.mockImplementation(async () => rows.map(copyRow))
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
    const identity =
      u.identityRuleId !== undefined
        ? {
            identityRuleId: u.identityRuleId,
            identityLine: u.identityLine ?? null,
            identitySeverity: u.identitySeverity ?? null,
            identityEvidenceHash: u.identityEvidenceHash ?? null,
            identityTitleTokens: u.identityTitleTokens ?? [],
            identityHistory: u.identityHistory ?? [],
          }
        : {}
    if (r) {
      Object.assign(r, {
        commentId: u.commentId,
        threadNodeId: u.threadNodeId ?? null,
        state: u.state ?? 'OPEN',
        addressedInSha: null,
        ...identity,
      })
      return
    }
    rows.push({
      id: `t${rows.length + 1}-${u.fingerprint}`,
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
      identityRuleId: null,
      identityLine: null,
      identitySeverity: null,
      identityEvidenceHash: null,
      identityTitleTokens: [],
      identityHistory: [],
      aliasFingerprints: [],
      ...identity,
    })
  })

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
    evidence: evidence.get(f.fingerprint) ?? '',
  }))
}

const marker = (fp: string) => `<!-- lumo-security:fp:${fp} -->`
const markerFp = (body: string) =>
  /<!--\s*lumo-security:fp:([^\s>]+?)\s*-->/.exec(body)?.[1] ?? null

/**
 * One PR write-back as `security-pr-review.service` runs it on a full
 * re-review of the same head: the scan row's findings are replaced (only
 * what this round reports reads back), threads reconciled, every inline
 * finding with no thread yet posted and recorded.
 */
async function writeBack(
  findings: ReviewFindingRow[],
  headSha = HEAD
): Promise<string[]> {
  repo.findIdentitiesByFingerprints.mockImplementation(async (_pr, fps) =>
    identitiesOf(findings).filter(i => fps.includes(i.fingerprint))
  )
  const ctx: ThreadSyncContext = {
    pullRequestId: 'pr67',
    workspaceId: 'w1',
    repo: { owner: 'Lumo-Workspace', name: 'lumo-agent-test' },
    prNumber: 67,
    token: 'tok',
    headSha,
    scan: COMPLETE,
    findings,
    open: findings,
    comments: ghComments.map(c => ({ ...c })) as never,
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

const openersOn = (fp: string) =>
  ghComments.filter(c => markerFp(c.body) === fp)
const rowOf = (fp: string) =>
  rows.find(r => r.fingerprint === fp || r.aliasFingerprints?.includes(fp))

describe('TC12 replay — PR 67 r1→r4, one issue relabelled across classes on one line', () => {
  it('ONE thread for src/server.ts:31, never "Addressed" or "Reappeared" on the unchanged head', async () => {
    const r1 = await writeBack(R1())
    expect(r1).toEqual(
      expect.arrayContaining([
        '3be89b9bcac588d7',
        'auth39000000000000',
        LOGIC_FP,
      ])
    )
    const original = openersOn(LOGIC_FP)[0]!.id

    expect(await writeBack(R2())).toEqual([])
    // r3: relabelled review:api_misuse, worded unlike r2 — production
    // addressed the thread here and opened a second one on the same line.
    expect(await writeBack(R3())).toEqual([])
    expect(openersOn(API_FP)).toHaveLength(0)
    // r4: back to review:logic_error — production flipped the two threads.
    expect(await writeBack(R4())).toEqual([])

    expect(replies).toEqual([])
    expect(gh.resolveThread).not.toHaveBeenCalled()
    expect(gh.unresolveThread).not.toHaveBeenCalled()
    const routeRows = rows.filter(
      r => r.filePath === SERVER && r.ruleId.startsWith('review:')
    )
    expect(routeRows).toEqual([
      expect.objectContaining({ commentId: String(original), state: 'OPEN' }),
    ])
    expect(rowOf(API_FP)?.commentId).toBe(String(original))
    // The other threads of the PR kept their issues too.
    expect(rows.every(r => r.state === 'OPEN')).toBe(true)
    expect(ghComments).toHaveLength(3)

    // The fix push: a complete review no longer reports it → addressed once.
    expect(
      await writeBack(
        R4().filter(f => f.line !== 31),
        FIX
      )
    ).toEqual([])
    expect(replies.map(r => r.inReplyTo)).toEqual([original])
    expect(replies[0]!.body).toMatch(/^✅ Addressed in `7f1c2d3`/)
  })

  it('the thread keeps every identity it carried (r1 wording survives r2)', async () => {
    await writeBack(R1())
    await writeBack(R2())
    const row = rowOf(LOGIC_FP)!
    const stored = storedIdentityOf(row, KEY)!
    // r1's wording, compared against r3: matches only through the history.
    const r3 = hashIdentity(
      {
        ...identityOfRow(R3().find(f => f.fingerprint === API_FP)!),
      },
      KEY
    )
    expect(stored.history!.length).toBe(2)
    expect(sameIssueScore(stored, r3)).not.toBeNull()
    // Without the history (r2 only) the class differs and two words are shared.
    expect(sameIssueScore({ ...stored, history: [] }, r3)).toBeNull()
  })
})

/**
 * The state production was left in (#67 after r3): ERF addressed by Lumo on
 * the head, 9Sos open for the relabel. The next round must not flip them.
 */
describe('a pair already flipped in production is merged, not flipped again', () => {
  async function seedFlipped(): Promise<{ erf: number; sos: number }> {
    await writeBack(R1())
    await writeBack(R2())
    const erf = openersOn(LOGIC_FP)[0]!.id
    const erfRow = rowOf(LOGIC_FP)!
    // r3 under the old rules: ERF addressed, 9Sos posted on the same line.
    ghThreads.get(String(erf))!.isResolved = true
    ghThreads.get(String(erf))!.resolvedBy = {
      login: 'uselumo[bot]',
      type: 'User',
    } as never
    Object.assign(erfRow, { state: 'ADDRESSED', addressedInSha: HEAD })
    const sos = nextId++
    ghComments.unshift({ id: sos, body: marker(API_FP), user: BOT })
    ghThreads.set(String(sos), {
      id: `PRRT_${sos}`,
      isResolved: false,
      isOutdated: false,
      resolvedBy: null,
      firstCommentId: sos,
    })
    const api = R3().find(f => f.fingerprint === API_FP)!
    rows.push({
      ...copyRow(erfRow),
      id: 't-sos',
      fingerprint: API_FP,
      ruleId: api.ruleId,
      commentId: String(sos),
      threadNodeId: `PRRT_${sos}`,
      state: 'OPEN',
      addressedInSha: null,
      aliasFingerprints: [],
      ...threadIdentityOf(api, ROUTE, KEY),
    })
    return { erf, sos }
  }

  it('r4: 9Sos is merged into ERF as a duplicate (no "Addressed" on it); ERF stays the one thread', async () => {
    const { erf, sos } = await seedFlipped()
    expect(await writeBack(R4())).toEqual([])
    // 9Sos: closed as a duplicate of ERF — never "Addressed".
    const onSos = replies.filter(r => r.inReplyTo === sos)
    expect(onSos).toHaveLength(1)
    expect(onSos[0]!.body).toMatch(/^🔗 Duplicate/)
    expect(replies.some(r => /Addressed/.test(r.body))).toBe(false)
    // ERF was wrongly addressed by the old rules: reopened once, as the one
    // thread of the issue.
    expect(replies.filter(r => r.inReplyTo === erf).map(r => r.body)).toEqual([
      expect.stringMatching(/^⚠️ Reappeared/),
    ])
    expect(
      rows.filter(r => r.filePath === SERVER && r.ruleId.startsWith('review:'))
    ).toEqual([
      expect.objectContaining({ commentId: String(erf), state: 'OPEN' }),
    ])
    // ERF carries 9Sos's identity too.
    expect(
      (rowOf(LOGIC_FP)!.identityHistory ?? []).map(v => v.ruleId)
    ).toContain('review:api_misuse')
    // Later relabels on the same head: nothing more is said anywhere.
    const said = replies.length
    for (const r of [R3(), R4(), R3()]) expect(await writeBack(r)).toEqual([])
    expect(replies).toHaveLength(said)
    expect(ghThreads.get(String(erf))!.isResolved).toBe(false)
  })
})

describe('rule 2 — same layer, same line: one issue whatever the class', () => {
  it('a relabel on the same line to an unrelated class with an unrelated title is carried', async () => {
    await writeBack(R1())
    const odd = finding(
      {
        fingerprint: 'ffff000011112222',
        ruleId: 'review:performance',
        line: 31,
        title: 'Inefficient lookup',
      },
      ROUTE
    )
    expect(await writeBack([...R1().filter(f => f.line !== 31), odd])).toEqual(
      []
    )
    expect(replies).toEqual([])
    expect(rowOf(odd.fingerprint)?.fingerprint).toBe(LOGIC_FP)
  })

  it('two findings on the line in one round: titles decide; an unmatched one is held, never a second thread', async () => {
    await writeBack(R1())
    const a = finding(
      {
        fingerprint: 'aaaa000011112222',
        ruleId: 'review:performance',
        line: 31,
        title: 'Inefficient lookup',
      },
      ROUTE
    )
    const b = finding(
      {
        fingerprint: 'bbbb000011112222',
        ruleId: 'review:error_handling',
        line: 31,
        title: 'Rejected promise ignored',
      },
      ROUTE
    )
    expect(await writeBack([...R1().filter(f => f.line !== 31), a, b])).toEqual(
      []
    )
    expect(replies).toEqual([])
    expect(rowOf(LOGIC_FP)?.state).toBe('OPEN')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[pr-finding-thread] ambiguous same-line finding')
    )
  })

  it('a thread whose history saw a distinct issue on its line falls back to title rules', async () => {
    const other = finding(
      {
        fingerprint: 'cccc000011112222',
        ruleId: 'review:performance',
        line: 31,
        title: 'Linear scan over sessions on every request',
      },
      ROUTE
    )
    // r1: two distinct issues on the line, both posted.
    await writeBack([...R1(), other])
    expect(openersOn(other.fingerprint)).toHaveLength(1)
    expect(storedIdentityOf(rowOf(LOGIC_FP)!, KEY)!.crowded).toBe(true)
    // r2: the route issue is fixed; only the other one is reported — it has
    // its own thread, so the route thread is addressed (no merge, no hold).
    await writeBack([...R1().filter(f => f.line !== 31), other])
    expect(rowOf(LOGIC_FP)?.state).toBe('ADDRESSED')
    expect(rowOf(other.fingerprint)?.state).toBe('OPEN')
    expect(rows).toHaveLength(4)
  })

  it('±3 lines still need a similar title (or a shared class): a different issue nearby does not carry', async () => {
    await writeBack(R1())
    const near = finding(
      {
        fingerprint: 'dddd000011112222',
        ruleId: 'review:performance',
        line: 33,
        title: 'Response body built with string concatenation',
      },
      '    res.end(body + extra)'
    )
    expect(await writeBack([...R1().filter(f => f.line !== 31), near])).toEqual(
      [near.fingerprint]
    )
    expect(rowOf(LOGIC_FP)?.state).toBe('ADDRESSED')
  })
})

describe('identity history', () => {
  it('is a deduplicated union, capped (the first identity is kept)', () => {
    const v = (n: number) => ({
      ruleId: `review:logic_error`,
      line: n,
      evidenceHash: null,
      titleTokens: [`t${n}`],
    })
    let h = addIdentityVariant([], v(1))
    h = addIdentityVariant(h, v(1))
    expect(h).toHaveLength(1)
    for (let i = 2; i <= IDENTITY_HISTORY_CAP + 5; i += 1)
      h = addIdentityVariant(h, v(i))
    expect(h).toHaveLength(IDENTITY_HISTORY_CAP)
    expect(h[0]!.line).toBe(1)
    expect(h[h.length - 1]!.line).toBe(IDENTITY_HISTORY_CAP + 5)
  })

  it('a duplicate variant marks crowded once seen crowded, and fills a missing evidence hash', () => {
    const base = {
      ruleId: 'review:logic_error',
      line: 3,
      evidenceHash: null,
      titleTokens: ['a'],
    }
    const h = addIdentityVariant(
      addIdentityVariant([base], { ...base, crowded: true }),
      { ...base, evidenceHash: 'k.e' }
    )
    expect(h).toEqual([{ ...base, crowded: true, evidenceHash: 'k.e' }])
  })

  it("mergedHistory: the kept row gains the dropped one's identities; null when nothing is added", () => {
    const r = (
      fp: string,
      title: string,
      ruleId: string
    ): FindingThreadRow => ({
      id: fp,
      pullRequestId: 'p',
      fingerprint: fp,
      commentId: '1',
      threadNodeId: null,
      state: 'OPEN',
      ruleId,
      provenance: 'LLM_JUDGE',
      kind: 'CORRECTNESS',
      filePath: SERVER,
      resolvedByLogin: null,
      addressedInSha: null,
      ...threadIdentityOf(
        { ruleId, line: 31, severity: 'MEDIUM', title },
        ROUTE,
        KEY
      ),
    })
    const keep = r('a', 'Route prefix match is loose', 'review:logic_error')
    const drop = r('b', 'Route ignores method', 'review:api_misuse')
    expect(mergedHistory(keep, drop, KEY)!.map(v => v.ruleId)).toEqual([
      'review:logic_error',
      'review:api_misuse',
    ])
    expect(mergedHistory(keep, keep, KEY)).toBeNull()
  })

  it('planThreadActions without identities never holds (matching off)', () => {
    const row: FindingThreadRow = {
      id: 'r',
      pullRequestId: 'p',
      fingerprint: LOGIC_FP,
      commentId: '1',
      threadNodeId: 'T',
      state: 'OPEN',
      ruleId: 'review:logic_error',
      provenance: 'LLM_JUDGE',
      kind: 'CORRECTNESS',
      filePath: SERVER,
      resolvedByLogin: null,
      addressedInSha: null,
    }
    const api = R3().find(f => f.fingerprint === API_FP)!
    const plan = planThreadActions({
      rows: [row],
      findings: [api],
      open: [api],
      scan: COMPLETE,
      headSha: HEAD,
      remote: null,
    })
    expect(plan.actions.map(a => a.kind)).toEqual(['ADDRESS'])
  })
})

function identityOfRow(f: ReviewFindingRow): FindingIdentity {
  return {
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    provenance: f.provenance,
    filePath: f.filePath,
    line: f.line,
    title: f.title,
    severity: f.severity,
    evidence: evidence.get(f.fingerprint) ?? null,
  }
}
