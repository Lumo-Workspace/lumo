/**
 * @jest-environment node
 *
 * LUM-1200 — one issue, one Lumo thread. Production (probe PR 51, head
 * 77de048): the AI review raised `vuln:command_injection` HIGH at
 * src/probe/run.ts:5 and the exploit-path hunt raised `hunt:injection` HIGH
 * at the same line for the same root cause; different fingerprints, so two
 * inline threads. Now the write-back posts one thread and lists the other
 * finding in it — both findings stay recorded.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      updateIssueComment: jest.fn(),
      updateReviewLineComment: jest.fn(),
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn().mockResolvedValue(undefined),
    claimInlineComments: jest.fn(),
    releaseInlineCommentClaims: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/ee/security/services/pr-finding-thread.service', () => {
  const actual = jest.requireActual(
    '@/ee/security/services/pr-finding-thread.service'
  )
  return {
    ...actual,
    prFindingThreadService: {
      reconcile: jest.fn(),
      recordPosted: jest.fn().mockResolvedValue(undefined),
    },
  }
})
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
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
  securityPrReviewService,
  fingerprintMarker,
} from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import {
  prSecurityScanRepository,
  type ReviewFindingRow,
} from '@/ee/security/repositories/pr-security-scan.repository'
import {
  NO_THREADS,
  prFindingThreadService,
} from '@/ee/security/services/pr-finding-thread.service'

const repo = prSecurityScanRepository as unknown as Record<string, jest.Mock>
const createReview = prCommentClient.createReview as jest.Mock
const listReviewComments = prCommentClient.listReviewComments as jest.Mock
const updateReviewLineComment =
  prCommentClient.updateReviewLineComment as jest.Mock
const reconcile = prFindingThreadService.reconcile as jest.Mock
const recordPosted = prFindingThreadService.recordPosted as jest.Mock

const JUDGE_FP = '94e5f611b607a693'
const HUNT_FP = '9218316eec2ba0e8'

const judge: ReviewFindingRow = {
  id: 'f-judge',
  kind: 'VULNERABILITY',
  ruleId: 'vuln:command_injection',
  severity: 'HIGH',
  provenance: 'LLM_JUDGE',
  filePath: 'src/probe/run.ts',
  line: 5,
  title: 'Shell command built by concatenating unsanitized dir argument',
  detail: 'exec runs the string through a shell. Use execFile instead.',
  fingerprint: JUDGE_FP,
  externalRef: null,
  disposition: null,
  persisting: false,
  suggestedDisposition: null,
  verifierVerdict: null,
  verifierReason: null,
}

const hunt: ReviewFindingRow = {
  ...judge,
  id: 'f-hunt',
  ruleId: 'hunt:injection',
  title:
    'The dir parameter is concatenated directly into an exec shell command without sanitization',
  detail: 'Caller passes unsanitized user input as the dir parameter.',
  fingerprint: HUNT_FP,
}

function scanRow(findings: ReviewFindingRow[]) {
  return {
    id: 's1',
    headSha: '77de048aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'FINDINGS',
    stages: {
      secrets: 'RAN',
      external: 'RAN',
      judge: 'RAN',
      hunt: 'RAN',
    },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    findings,
    pullRequest: {
      id: 'pr1',
      repo: 'acme/app',
      number: 51,
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'acme' },
    },
  }
}

function postedComments(): Array<{ path: string; line: number; body: string }> {
  return createReview.mock.calls.flatMap(([req]) => req.comments)
}

const bot = { id: 9, type: 'Bot', login: 'uselumo[bot]' }

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.createIssueComment as jest.Mock).mockResolvedValue({
    id: 1,
  })
  createReview.mockResolvedValue({ id: 2, html_url: 'https://gh/review' })
  updateReviewLineComment.mockResolvedValue(undefined)
  listReviewComments.mockResolvedValue([])
  reconcile.mockResolvedValue(NO_THREADS)
  repo.claimInlineComments!.mockImplementation(
    async (ids: string[]) => new Set(ids)
  )
})

describe('LUM-1200 one thread per issue across AI review and hunt', () => {
  it('posts exactly one inline thread for the same injection on the same line, with both findings recorded', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow([judge, hunt]))
    const res = await securityPrReviewService.sync('s1')

    const comments = postedComments()
    expect(comments).toHaveLength(1)
    expect(res.inline).toBe(1)
    const [only] = comments
    expect(only).toMatchObject({ path: 'src/probe/run.ts', line: 5 })
    // The kept finding owns the thread (its fingerprint marker)…
    expect(only!.body).toContain(fingerprintMarker(JUDGE_FP))
    expect(only!.body).not.toContain(fingerprintMarker(HUNT_FP))
    // …and the merged one is listed in it, not dropped.
    expect(only!.body).toContain('Exploit paths')
    expect(only!.body).toContain(hunt.title)
    expect(only!.body).toContain(`lumo-security:also:${HUNT_FP}`)
    // Only the kept finding gets a thread row.
    expect(recordPosted).toHaveBeenCalledTimes(1)
    expect(
      (recordPosted.mock.calls[0]![2] as ReviewFindingRow[]).map(
        f => f.fingerprint
      )
    ).toEqual([JUDGE_FP])
  })

  it('a hunt finding landing after the AI review thread is listed in that thread, not posted again', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow([judge, hunt]))
    const keptBody = `**Lumo · LLM review · HIGH** — ${judge.title}\n\n${judge.detail}\n\n${fingerprintMarker(JUDGE_FP)}`
    listReviewComments.mockResolvedValue([
      {
        id: 4283174217,
        node_id: 'n',
        html_url: '',
        body: keptBody,
        updated_at: '',
        user: bot,
      },
    ])
    await securityPrReviewService.sync('s1')

    expect(postedComments()).toHaveLength(0)
    expect(updateReviewLineComment).toHaveBeenCalledTimes(1)
    const [edit] = updateReviewLineComment.mock.calls[0]!
    expect(edit.externalId).toBe('4283174217')
    expect(edit.body).toContain(fingerprintMarker(JUDGE_FP))
    expect(edit.body).toContain(`lumo-security:also:${HUNT_FP}`)
    expect(edit.body).toContain(hunt.title)
  })

  it('edits the kept comment only once (idempotent on the next sync)', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow([judge, hunt]))
    const body = `**Lumo · LLM review · HIGH** — ${judge.title}\n\n_Same issue also reported by Exploit paths (HIGH): ${hunt.title}_\n<!-- lumo-security:also:${HUNT_FP} -->\n\n${fingerprintMarker(JUDGE_FP)}`
    listReviewComments.mockResolvedValue([
      { id: 1, node_id: 'n', html_url: '', body, updated_at: '', user: bot },
    ])
    await securityPrReviewService.sync('s1')
    expect(updateReviewLineComment).not.toHaveBeenCalled()
    expect(postedComments()).toHaveLength(0)
  })

  it('a human resolving the kept thread closes the merged finding too (never re-posted on its own)', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow([judge, hunt]))
    reconcile.mockResolvedValue({
      ...NO_THREADS,
      resolvedByUser: new Set([JUDGE_FP]),
      counts: { open: 0, addressed: 0, resolved: 1 },
    })
    await securityPrReviewService.sync('s1')
    expect(postedComments()).toHaveLength(0)
  })

  it('a disposition on the kept finding does not cascade: the still-open merged finding gets its own thread', async () => {
    repo.findByIdForReview!.mockResolvedValue(
      scanRow([{ ...judge, disposition: 'FALSE_POSITIVE' }, hunt])
    )
    await securityPrReviewService.sync('s1')
    const comments = postedComments()
    expect(comments).toHaveLength(1)
    expect(comments[0]!.body).toContain(fingerprintMarker(HUNT_FP))
  })

  it('different vulnerability classes on the same line keep separate threads', async () => {
    repo.findByIdForReview!.mockResolvedValue(
      scanRow([judge, { ...hunt, ruleId: 'hunt:ssrf' }])
    )
    await securityPrReviewService.sync('s1')
    expect(postedComments()).toHaveLength(2)
  })
})
