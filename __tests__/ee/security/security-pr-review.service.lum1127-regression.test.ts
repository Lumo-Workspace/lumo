/**
 * @jest-environment node
 *
 * LUM-1127 prod regression (lumo-agent-test PR 22): c1 put `return eval(expr)`
 * on line 5 → HIGH inline thread; c2 removed it → Lumo resolved the thread
 * "✅ Addressed"; c3 put the same line back → the scan reported the finding
 * again, but the thread stayed resolved, no "Reappeared" note and no fresh
 * comment — the summary counted it "1 resolved on GitHub".
 *
 * Root cause: GitHub's GraphQL types `resolvedBy` as `User` even for an App's
 * bot (`{ login: "uselumo[bot]", __typename: "User" }`, read live off PR 22),
 * so `isLumoActor` took Lumo's own resolve for a human's. Any sync that saw
 * the row still OPEN while GitHub already showed it resolved — two syncs of
 * one scan racing (scan end + verifier + managed run all sync) — recorded
 * RESOLVED_BY_USER, and a human-resolved thread is never reopened or
 * re-posted.
 *
 * Drives the real write-back + real `planThreadActions` against an in-memory
 * GitHub (threads shaped by the real `toReviewThreadState` from the GraphQL
 * node) and an in-memory thread table.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn().mockResolvedValue({ id: 55 }),
      updateIssueComment: jest.fn(),
      createReview: jest.fn(),
      updateReviewLineComment: jest.fn(),
      listIssueComments: jest.fn().mockResolvedValue([]),
      listReviewComments: jest.fn(),
      createReviewLineReply: jest.fn(),
      listReviewCommentsOfReview: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/review-threads', () => {
  const actual = jest.requireActual('@/lib/integrations/github/review-threads')
  return {
    toReviewThreadState: actual.toReviewThreadState,
    reviewThreadClient: {
      listReviewThreads: jest.fn(),
      resolveThread: jest.fn(),
      unresolveThread: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    findLayerMetaByFingerprints: jest.fn().mockResolvedValue([]),
    findIdentitiesByFingerprints: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
}))
jest.mock('@/ee/security/services/scan-evidence-retention.service', () => ({
  scrubScanIfZeroRetention: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import {
  reviewThreadClient,
  toReviewThreadState,
} from '@/lib/integrations/github/review-threads'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import type {
  FindingThreadRow,
  FindingThreadUpsert,
  FindingThreadPatch,
} from '@/ee/security/repositories/pr-finding-thread.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'

const C1 = '0a28064' + '0'.repeat(33)
const C2 = '8a7608c' + '0'.repeat(33)
const C3 = '23d7af5' + '0'.repeat(33)
const FILE = 'scripts/probes/acceptance-probe.ts'
const EVAL_FP = 'ffb8ab7d581546d7'
const EXEC_FP = 'ba24087afb45a944'
const LUMO = { login: 'uselumo[bot]', type: 'Bot' }

// ── In-memory GitHub ──────────────────────────────────────────────────────

interface FakeComment {
  id: number
  body: string
  user: { login: string; type: string }
  in_reply_to_id: number | null
  path: string
  line: number
}
interface FakeThread {
  id: string
  firstCommentId: number
  isResolved: boolean
  isOutdated: boolean
  /** As GraphQL reports it: the bot is a `User`. */
  resolvedBy: { login: string; __typename: string } | null
}

let comments: FakeComment[]
let threads: FakeThread[]
let nextId: number
const reviews = new Map<number, number[]>()
/** Runs once inside the next thread read — to interleave a concurrent sync. */
let duringNextThreadRead: (() => Promise<unknown>) | null

// ── In-memory thread table ────────────────────────────────────────────────

let rows: Map<string, FindingThreadRow>

function installFakes(): void {
  comments = []
  threads = []
  nextId = 4272005229
  reviews.clear()
  rows = new Map()
  duringNextThreadRead = null
  ;(prCommentClient.listReviewComments as jest.Mock).mockImplementation(
    async () => [...comments].reverse().map(c => ({ ...c }))
  )
  ;(prCommentClient.createReview as jest.Mock).mockImplementation(
    async (input: {
      comments: Array<{ path: string; line: number; body: string }>
    }) => {
      const reviewId = nextId++
      const ids: number[] = []
      for (const c of input.comments) {
        const id = nextId++
        comments.push({
          id,
          body: c.body,
          user: LUMO,
          in_reply_to_id: null,
          path: c.path,
          line: c.line,
        })
        threads.push({
          id: `PRRT_${id}`,
          firstCommentId: id,
          isResolved: false,
          isOutdated: false,
          resolvedBy: null,
        })
        ids.push(id)
      }
      reviews.set(reviewId, ids)
      return { id: reviewId }
    }
  )
  ;(prCommentClient.listReviewCommentsOfReview as jest.Mock).mockImplementation(
    async (input: { reviewId: number }) =>
      comments.filter(c => (reviews.get(input.reviewId) ?? []).includes(c.id))
  )
  ;(prCommentClient.createReviewLineReply as jest.Mock).mockImplementation(
    async (input: { inReplyTo: number; body: string }) => {
      const parent = comments.find(c => c.id === input.inReplyTo)!
      const id = nextId++
      comments.push({
        id,
        body: input.body,
        user: LUMO,
        in_reply_to_id: input.inReplyTo,
        path: parent.path,
        line: parent.line,
      })
      return { id }
    }
  )
  ;(reviewThreadClient.listReviewThreads as jest.Mock).mockImplementation(
    async () => {
      const hook = duringNextThreadRead
      duringNextThreadRead = null
      if (hook) await hook()
      return threads.map(t =>
        toReviewThreadState({
          id: t.id,
          isResolved: t.isResolved,
          isOutdated: t.isOutdated,
          resolvedBy: t.resolvedBy,
          comments: { nodes: [{ databaseId: t.firstCommentId }] },
        })
      )
    }
  )
  ;(reviewThreadClient.resolveThread as jest.Mock).mockImplementation(
    async (input: { threadId: string }) => {
      const t = threads.find(x => x.id === input.threadId)!
      t.isResolved = true
      t.resolvedBy = { login: 'uselumo[bot]', __typename: 'User' }
    }
  )
  ;(reviewThreadClient.unresolveThread as jest.Mock).mockImplementation(
    async (input: { threadId: string }) => {
      const t = threads.find(x => x.id === input.threadId)!
      t.isResolved = false
      t.resolvedBy = null
    }
  )
  ;(
    prFindingThreadRepository.findByPullRequest as jest.Mock
  ).mockImplementation(async () => [...rows.values()].map(r => ({ ...r })))
  ;(prFindingThreadRepository.upsert as jest.Mock).mockImplementation(
    async (input: FindingThreadUpsert) => {
      const prev = rows.get(input.fingerprint)
      rows.set(input.fingerprint, {
        id: prev?.id ?? `row-${input.fingerprint}`,
        pullRequestId: input.pullRequestId,
        fingerprint: input.fingerprint,
        commentId: input.commentId,
        threadNodeId: input.threadNodeId ?? null,
        state: input.state ?? 'OPEN',
        resolvedByLogin: input.resolvedByLogin ?? null,
        addressedInSha: null,
        ruleId: input.ruleId,
        provenance: input.provenance,
        kind: input.kind,
        filePath: input.filePath,
      })
    }
  )
  // The newest finding row of each fingerprint across the PR's scans.
  ;(
    prFindingThreadRepository.findIdentitiesByFingerprints as jest.Mock
  ).mockImplementation(async (_pr: string, fps: string[]) => {
    const out = new Map<string, Record<string, unknown>>()
    for (const s of [...scans.values()].reverse())
      for (const f of s.findings)
        if (fps.includes(f.fingerprint) && !out.has(f.fingerprint))
          out.set(f.fingerprint, {
            fingerprint: f.fingerprint,
            ruleId: f.ruleId,
            provenance: f.provenance,
            filePath: f.filePath,
            line: f.line,
            title: f.title,
            evidence: evidenceOf.get(f.fingerprint) ?? '',
          })
    return [...out.values()]
  })
  ;(prFindingThreadRepository.update as jest.Mock).mockImplementation(
    async (id: string, patch: FindingThreadPatch) => {
      const row = [...rows.values()].find(r => r.id === id)!
      Object.assign(row, patch)
    }
  )
}

// ── Scans ─────────────────────────────────────────────────────────────────

function judgeFinding(
  over: Partial<ReviewFindingRow> & { fingerprint: string }
): ReviewFindingRow {
  return {
    id: `f-${over.fingerprint}`,
    kind: 'VULNERABILITY',
    ruleId: 'vuln:unsafe_eval',
    severity: 'HIGH',
    provenance: 'LLM_JUDGE',
    filePath: FILE,
    line: 5,
    title: 'eval of caller-supplied expression',
    detail: 'The argument reaches eval.',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

const evalFinding = (over: Partial<ReviewFindingRow> = {}) =>
  judgeFinding({ fingerprint: EVAL_FP, ...over })
const execFinding = () =>
  judgeFinding({
    fingerprint: EXEC_FP,
    ruleId: 'vuln:command_injection',
    line: 9,
    title: 'Shell command built by concatenating unsanitized input',
  })

/** The quoted evidence line of a finding, by fingerprint (default: none). */
const evidenceOf = new Map<string, string>()

const scans = new Map<
  string,
  { headSha: string; findings: ReviewFindingRow[] }
>()

function scanRow(id: string) {
  const s = scans.get(id)!
  return {
    id,
    headSha: s.headSha,
    status: s.findings.length > 0 ? 'FINDINGS' : 'CLEAN',
    stages: { secrets: 'RAN', judge: 'RAN', hunt: 'SKIPPED' },
    partial: false,
    error: null,
    summaryCommentId: null,
    suggestedAt: new Date('2026-10-14T00:00:00Z'),
    verifierStartedAt: null,
    verifiedAt: null,
    judgeReviewScope: null,
    findings: s.findings,
    pullRequest: {
      id: 'pr22',
      repo: 'Lumo-Workspace/lumo-agent-test',
      number: 22,
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'lumo', securityPolicy: null },
    },
  }
}

/** A push: the eval line's comment no longer matches the head — outdated. */
function push(scanId: string, headSha: string, findings: ReviewFindingRow[]) {
  scans.set(scanId, { headSha, findings })
}
function outdateThreadOf(fp: string): void {
  const c = comments.find(
    x => x.in_reply_to_id === null && x.body.includes(`lumo-security:fp:${fp}`)
  )!
  threads.find(t => t.firstCommentId === c.id)!.isOutdated = true
}

const sync = (scanId: string) => securityPrReviewService.syncReview(scanId)

/** Lumo's eval-finding comments that open a thread, oldest first. */
const evalThreadOpeners = () =>
  comments.filter(
    c =>
      c.in_reply_to_id === null &&
      c.body.includes(`lumo-security:fp:${EVAL_FP}`)
  )
const notes = (re: RegExp) =>
  comments.filter(c => c.in_reply_to_id !== null && re.test(c.body))

const OLD_SLUG = process.env.GITHUB_APP_SLUG

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  ;(prSecurityScanRepository.findByIdForReview as jest.Mock).mockImplementation(
    async (id: string) => scanRow(id)
  )
  scans.clear()
  evidenceOf.clear()
  installFakes()
})
afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

/** c1 → c2 with two syncs of the c2 scan racing, exactly as in production. */
async function c1ThenRacingC2(): Promise<void> {
  push('c1', C1, [evalFinding(), execFinding()])
  await sync('c1')
  expect(evalThreadOpeners()).toHaveLength(1)

  push('c2', C2, [execFinding()])
  outdateThreadOf(EVAL_FP)
  // Sync B loads the thread rows (eval still OPEN), then — before it reads
  // GitHub — sync A of the same scan resolves the eval thread as addressed.
  duringNextThreadRead = () => sync('c2')
  await sync('c2')
  expect(notes(/Addressed in `8a7608c`/)).toHaveLength(1)
}

describe('LUM-1127 regression: a regressed finding is visible again', () => {
  it('c1 → c2 (racing syncs) → c3: the reintroduced eval gets a fresh inline comment', async () => {
    await c1ThenRacingC2()
    // Lumo resolved the thread itself — it is addressed, not a human's resolve.
    expect(rows.get(EVAL_FP)?.state).toBe('ADDRESSED')

    push('c3', C3, [
      evalFinding({ title: 'eval on caller-supplied expression' }),
      execFinding(),
    ])
    const out = await sync('c3')

    // Outdated thread ⇒ REPOST: a fresh comment on line 5…
    const openers = evalThreadOpeners()
    expect(openers).toHaveLength(2)
    expect(openers[1]).toEqual(expect.objectContaining({ path: FILE, line: 5 }))
    expect(out.inline).toBe(1)
    // …recorded as the finding's open thread.
    expect(rows.get(EVAL_FP)).toEqual(
      expect.objectContaining({
        state: 'OPEN',
        commentId: String(openers[1]!.id),
      })
    )
    const created = (prCommentClient.createIssueComment as jest.Mock).mock.calls
    const summary = String(created[created.length - 1]?.[0]?.body)
    expect(summary).toMatch(/lumo-security:summary/)
    expect(summary).not.toMatch(/resolved on GitHub/)
  })

  it('a row already stuck as RESOLVED_BY_USER by Lumo itself (prod PR 22) recovers on the next sync', async () => {
    push('c1', C1, [evalFinding(), execFinding()])
    await sync('c1')
    const opener = evalThreadOpeners()[0]!
    const t = threads.find(x => x.firstCommentId === opener.id)!
    Object.assign(t, {
      isResolved: true,
      isOutdated: true,
      resolvedBy: { login: 'uselumo[bot]', __typename: 'User' },
    })
    Object.assign(rows.get(EVAL_FP)!, {
      state: 'RESOLVED_BY_USER',
      resolvedByLogin: 'uselumo[bot]',
    })

    push('c3', C3, [evalFinding(), execFinding()])
    await sync('c3')
    expect(evalThreadOpeners()).toHaveLength(2)
    expect(rows.get(EVAL_FP)?.state).toBe('OPEN')
  })

  it('not outdated ⇒ the addressed thread is reopened with a regression note', async () => {
    push('c1', C1, [evalFinding(), execFinding()])
    await sync('c1')
    push('c2', C2, [execFinding()])
    duringNextThreadRead = () => sync('c2')
    await sync('c2')

    push('c3', C3, [evalFinding(), execFinding()])
    await sync('c3')
    const opener = evalThreadOpeners()
    expect(opener).toHaveLength(1)
    expect(
      threads.find(x => x.firstCommentId === opener[0]!.id)?.isResolved
    ).toBe(false)
    expect(notes(/Reappeared in `23d7af5`/)).toHaveLength(1)
    expect(rows.get(EVAL_FP)?.state).toBe('OPEN')
  })

  /**
   * Decision: a regression whose fingerprint changed (the model quoted a
   * different evidence line, or none, so the key fell back to the title) is
   * a new finding to the thread table — it is posted as a new inline
   * comment, and the old addressed thread stays resolved. Visible either way;
   * no rule+file+line matching for an ADDRESSED thread (a re-keyed finding on
   * the same line can be a different problem). The same-issue match of the
   * LUM-1127 follow-up below only keeps an OPEN thread from being resolved.
   */
  it('fingerprint changed ⇒ posted as a new inline comment (old thread stays addressed)', async () => {
    await c1ThenRacingC2()
    push('c3', C3, [
      evalFinding({
        fingerprint: '96681671e211e4da',
        title: 'eval on caller-supplied expression',
      }),
      execFinding(),
    ])
    await sync('c3')
    const fresh = comments.filter(
      c =>
        c.in_reply_to_id === null &&
        c.body.includes('lumo-security:fp:96681671e211e4da')
    )
    expect(fresh).toHaveLength(1)
    expect(fresh[0]).toEqual(expect.objectContaining({ path: FILE, line: 5 }))
    expect(rows.get(EVAL_FP)?.state).toBe('ADDRESSED')
  })

  it('control: a human resolve (GraphQL `User`) is still honoured — never reopened or re-posted', async () => {
    push('c1', C1, [evalFinding(), execFinding()])
    await sync('c1')
    const opener = evalThreadOpeners()[0]!
    Object.assign(threads.find(x => x.firstCommentId === opener.id)!, {
      isResolved: true,
      resolvedBy: { login: 'alice', __typename: 'User' },
    })
    push('c3', C3, [evalFinding(), execFinding()])
    await sync('c3')
    expect(rows.get(EVAL_FP)).toEqual(
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: 'alice',
      })
    )
    expect(evalThreadOpeners()).toHaveLength(1)
    expect(reviewThreadClient.unresolveThread).not.toHaveBeenCalled()
  })
})

/**
 * LUM-1127 follow-up — prod probe PR 52 (heads 798ead5 → 5bb911d): a full
 * re-review reported the same issue, `console.log` in `scripts/probe.ts:3`,
 * but labelled it `review:api_misuse` instead of `review:doc_mismatch`. The
 * fingerprint carries the rule id, so the old one looked fixed: Lumo posted
 * "✅ Addressed" and resolved the thread while the finding was still listed.
 */
describe('LUM-1127 follow-up: a relabelled rule id is not a fix (prod PR 52)', () => {
  const P1 = '798ead5' + '0'.repeat(33)
  const P2 = '5bb911d' + '0'.repeat(33)
  const PROBE = 'scripts/probe.ts'
  const DOC_FP = '6911e1a7243ed238'
  const API_FP = '0f3c9a1b2d4e5f60'
  const consoleLog = (fingerprint: string, ruleId: string) =>
    judgeFinding({
      fingerprint,
      ruleId,
      kind: 'CORRECTNESS',
      severity: 'LOW',
      filePath: PROBE,
      line: 3,
      title: 'console.log used in scripts',
      detail:
        'The repository instruction for scripts/** requires flagging any console.log.',
      pathInstruction: 'scripts/**',
    })
  const openersOf = (fp: string) =>
    comments.filter(
      c =>
        c.in_reply_to_id === null && c.body.includes(`lumo-security:fp:${fp}`)
    )

  beforeEach(() => {
    evidenceOf.set(DOC_FP, "console.log('probe start')")
    evidenceOf.set(API_FP, "console.log('probe start')")
  })

  it('the thread stays open, no "Addressed" note and no second comment', async () => {
    push('p1', P1, [consoleLog(DOC_FP, 'review:doc_mismatch'), execFinding()])
    await sync('p1')
    const opener = openersOf(DOC_FP)
    expect(opener).toHaveLength(1)

    push('p2', P2, [consoleLog(API_FP, 'review:api_misuse'), execFinding()])
    await sync('p2')

    expect(notes(/Addressed in/)).toHaveLength(0)
    expect(reviewThreadClient.resolveThread).not.toHaveBeenCalled()
    expect(
      threads.find(t => t.firstCommentId === opener[0]!.id)?.isResolved
    ).toBe(false)
    expect(rows.get(DOC_FP)?.state).toBe('OPEN')
    // The relabelled finding is the old thread's — no duplicate comment.
    expect(openersOf(API_FP)).toHaveLength(0)
    const created = (prCommentClient.createIssueComment as jest.Mock).mock.calls
    const summary = String(created[created.length - 1]?.[0]?.body)
    expect(summary).toMatch(/2 open findings/)
    expect(summary).not.toMatch(/[1-9] addressed/)
  })

  it('stays open across a further relabel, and is addressed once the issue is gone', async () => {
    push('p1', P1, [consoleLog(DOC_FP, 'review:doc_mismatch'), execFinding()])
    await sync('p1')
    push('p2', P2, [consoleLog(API_FP, 'review:api_misuse'), execFinding()])
    await sync('p2')
    expect(rows.get(DOC_FP)?.state).toBe('OPEN')

    // The console.log is removed: nothing on the file continues it.
    push('p3', C3, [execFinding()])
    await sync('p3')
    expect(notes(/Addressed in `23d7af5`/)).toHaveLength(1)
    expect(rows.get(DOC_FP)?.state).toBe('ADDRESSED')
  })

  it('control: a different issue on the same file does not keep the thread open', async () => {
    push('p1', P1, [consoleLog(DOC_FP, 'review:doc_mismatch'), execFinding()])
    await sync('p1')
    evidenceOf.set('aa11bb22cc33dd44', 'await run(dir)')
    push('p2', P2, [
      judgeFinding({
        fingerprint: 'aa11bb22cc33dd44',
        ruleId: 'review:error_handling',
        kind: 'CORRECTNESS',
        severity: 'MEDIUM',
        filePath: PROBE,
        line: 5,
        title: 'Rejected promise from run is never handled',
      }),
      execFinding(),
    ])
    await sync('p2')
    expect(notes(/Addressed in `5bb911d`/)).toHaveLength(1)
    expect(rows.get(DOC_FP)?.state).toBe('ADDRESSED')
  })
})
