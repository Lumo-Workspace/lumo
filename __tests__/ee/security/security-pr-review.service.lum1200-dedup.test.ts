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

  // Follow-up — production probe PR 60 (src/probe/session.ts @3202de1): the
  // hunt's `hunt:logic` reports one line from the AI review's threads got
  // threads of their own, the L13 one re-raising the Math.random issue the
  // developer had resolved on L14.
  describe('probe PR 60: hunt:logic on nearby lines', () => {
    const CRYPTO_FP = 'e319f42d5996a43c'
    const EXPIRY_FP = '12c23ea2a53e7f19'
    const base = { ...judge, filePath: 'src/probe/session.ts' }
    const judgeCrypto: ReviewFindingRow = {
      ...base,
      id: 'j-crypto',
      ruleId: 'vuln:weak_crypto',
      line: 14,
      title:
        'Session token generated with Math.random despite comment claiming CSPRNG',
      fingerprint: CRYPTO_FP,
    }
    const judgeExpiry: ReviewFindingRow = {
      ...base,
      id: 'j-expiry',
      ruleId: 'vuln:auth_bypass',
      line: 19,
      title: 'Session validity uses || so expired sessions remain valid',
      fingerprint: EXPIRY_FP,
    }
    const huntCrypto: ReviewFindingRow = {
      ...base,
      id: 'h-crypto',
      ruleId: 'hunt:logic',
      line: 13,
      title:
        'Session tokens use Math.random() instead of CSPRNG, allowing attackers to predict or enumerate valid session tokens with low entropy (~53 bits)',
      fingerprint: 'hunt-crypto-fp',
    }
    const huntExpiry: ReviewFindingRow = {
      ...base,
      id: 'h-expiry',
      ruleId: 'hunt:logic',
      line: 20,
      title:
        'Session validation uses OR logic (expiresAt > now || token.length > 0) allowing expired sessions to remain valid indefinitely, bypassing authentication expiry controls',
      fingerprint: 'hunt-expiry-fp',
    }
    const comment = (id: number, f: ReviewFindingRow) => ({
      id,
      node_id: `n${id}`,
      html_url: '',
      body: `**Lumo · LLM review · HIGH** — ${f.title}\n\n${fingerprintMarker(f.fingerprint)}`,
      updated_at: '',
      user: bot,
    })

    beforeEach(() => {
      repo.findByIdForReview!.mockResolvedValue(
        scanRow([judgeCrypto, judgeExpiry, huntCrypto, huntExpiry])
      )
      listReviewComments.mockResolvedValue([
        comment(4285358212, judgeExpiry),
        comment(4285358219, judgeCrypto),
      ])
      reconcile.mockResolvedValue({
        ...NO_THREADS,
        resolvedByUser: new Set([CRYPTO_FP]),
        counts: { open: 1, addressed: 0, resolved: 1 },
      })
    })

    it('posts no second thread: each hunt report joins the AI review thread for its issue', async () => {
      await securityPrReviewService.sync('s1')
      expect(postedComments()).toHaveLength(0)
      // The open L19 thread lists the L20 hunt report…
      expect(updateReviewLineComment).toHaveBeenCalledTimes(1)
      const [edit] = updateReviewLineComment.mock.calls[0]!
      expect(edit.externalId).toBe('4285358212')
      expect(edit.body).toContain('lumo-security:also:hunt-expiry-fp')
      // …and the L14 thread the developer resolved is left alone: the L13
      // report of the same issue is not raised again.
      expect(edit.body).not.toContain('hunt-crypto-fp')
    })

    it('a more severe hunt report of a resolved issue still gets its own thread', async () => {
      repo.findByIdForReview!.mockResolvedValue(
        scanRow([
          { ...judgeCrypto, severity: 'MEDIUM' },
          judgeExpiry,
          huntCrypto,
          huntExpiry,
        ])
      )
      await securityPrReviewService.sync('s1')
      const comments = postedComments()
      expect(comments).toHaveLength(1)
      expect(comments[0]!.body).toContain(fingerprintMarker('hunt-crypto-fp'))
    })
  })
})

// LUM-1200 follow-up #4 — production TC12 (lumo-agent-test#68 r2): the AI
// review relabelled its L13 report (review:logic_error → review:api_misuse,
// a new fingerprint carried onto the posted thread) and two new hunt reports
// joined it; the thread's comment, found by the NEW fingerprint's marker,
// was never found, so they were never listed.
describe('LUM-1200 follow-up #4: reports merged in a later round join the posted thread', () => {
  const OLD_FP = 'a1a1a1a1a1a1a1a1'
  const NEW_FP = 'b2b2b2b2b2b2b2b2'
  const relabelled: ReviewFindingRow = {
    ...judge,
    id: 'f-judge-r2',
    title: 'Command string concatenation reaches a shell',
    fingerprint: NEW_FP,
  }
  const hunt2: ReviewFindingRow = {
    ...hunt,
    id: 'f-hunt-2',
    title: 'dir flows unsanitized into exec',
    fingerprint: 'c3c3c3c3c3c3c3c3',
  }
  const hunt3: ReviewFindingRow = {
    ...hunt,
    id: 'f-hunt-3',
    line: 6,
    title: 'exec receives a string built from request input',
    fingerprint: 'd4d4d4d4d4d4d4d4',
  }
  // Posted in round 1 under the old fingerprint, listing round 1's hunt report.
  const postedBody = `**Lumo · LLM review · HIGH** — ${judge.title}\n\n${judge.detail}\n\nSame issue also reported by **Exploit paths** · HIGH — ${hunt.title}\n<!-- lumo-security:also:${HUNT_FP} -->\n\n${fingerprintMarker(OLD_FP)}`
  const posted = {
    id: 77,
    node_id: 'n',
    html_url: '',
    body: postedBody,
    updated_at: '',
    user: bot,
  }

  beforeEach(() => {
    reconcile.mockResolvedValue({
      ...NO_THREADS,
      carried: new Map([[NEW_FP, OLD_FP]]),
      counts: { open: 1, addressed: 0, resolved: 0 },
    })
  })

  it('appends the new reports to the posted comment, keeping its marker and earlier list', async () => {
    repo.findByIdForReview!.mockResolvedValue(
      scanRow([relabelled, hunt2, hunt3])
    )
    listReviewComments.mockResolvedValue([posted])
    await securityPrReviewService.sync('s1')

    expect(postedComments()).toHaveLength(0)
    expect(updateReviewLineComment).toHaveBeenCalledTimes(1)
    const [edit] = updateReviewLineComment.mock.calls[0]!
    expect(edit.externalId).toBe('77')
    expect(edit.body).toContain(`lumo-security:also:${HUNT_FP}`)
    expect(edit.body).toContain(`lumo-security:also:${hunt2.fingerprint}`)
    expect(edit.body).toContain(`lumo-security:also:${hunt3.fingerprint}`)
    expect(edit.body).toContain(hunt2.title)
    expect(edit.body.endsWith(fingerprintMarker(OLD_FP))).toBe(true)
    expect(edit.body).not.toContain(fingerprintMarker(NEW_FP))
  })

  it('does not edit the comment when every merged report is listed already', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow([relabelled, hunt]))
    listReviewComments.mockResolvedValue([posted])
    await securityPrReviewService.sync('s1')
    expect(updateReviewLineComment).not.toHaveBeenCalled()
    expect(postedComments()).toHaveLength(0)
  })

  it('never edits a comment that is not Lumo’s own', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow([relabelled, hunt2]))
    listReviewComments.mockResolvedValue([
      { ...posted, user: { id: 5, type: 'User', login: 'someone' } },
    ])
    await securityPrReviewService.sync('s1')
    expect(updateReviewLineComment).not.toHaveBeenCalled()
  })
})

// LUM-1200 follow-up #5 — production TC12 (lumo-agent-test#69 r6, head
// b2b8d69, src/server.ts:31): the AI review's finding that owns the open
// thread (carried onto it under a new fingerprint) was relabelled LOW — not
// inline-eligible — while the hunt reported the same issue at MEDIUM on the
// same line. The LOW owner left the grouping set, so the hunt report had no
// partner and was posted as a second thread.
describe('LUM-1200 follow-up #5: a thread owner relabelled LOW still takes in the hunt report', () => {
  const THREAD_FP = 'f51aeed8a5c37ca3'
  const LOW_FP = 'f041c2f4d3deddc4'
  const HUNT_LOGIC_FP = '9bcc37308a7a0e8e'
  const lowOwner: ReviewFindingRow = {
    ...judge,
    id: 'f-r6-review',
    kind: 'CORRECTNESS',
    ruleId: 'review:logic_error',
    severity: 'LOW',
    filePath: 'src/server.ts',
    line: 31,
    title: '/session/check has no method check and prefix matching is loose',
    detail: 'startsWith matches /session/checkXYZ and any HTTP method.',
    fingerprint: LOW_FP,
  }
  const huntLogic: ReviewFindingRow = {
    ...hunt,
    id: 'f-r6-hunt',
    kind: 'VULNERABILITY',
    ruleId: 'hunt:logic',
    severity: 'MEDIUM',
    filePath: 'src/server.ts',
    line: 31,
    title:
      'The /session/check route uses startsWith prefix matching without enforcing HTTP method, allowing POST/PUT/DELETE requests to reach the session validation logic',
    detail: 'Any method reaches checkSessionToken.',
    fingerprint: HUNT_LOGIC_FP,
  }
  const threadBody = `**Lumo · LLM review · bug · MEDIUM** — Session check route lacks method check and uses loose prefix matching\n\nThe route matches by prefix.\n\n${fingerprintMarker(THREAD_FP)}`
  const thread = {
    id: 4288611632,
    node_id: 'n',
    html_url: '',
    body: threadBody,
    updated_at: '',
    user: bot,
  }

  beforeEach(() => {
    reconcile.mockResolvedValue({
      ...NO_THREADS,
      carried: new Map([[LOW_FP, THREAD_FP]]),
      counts: { open: 1, addressed: 0, resolved: 0 },
    })
    listReviewComments.mockResolvedValue([thread])
  })

  it('posts no second thread and lists the hunt report in the open thread', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow([lowOwner, huntLogic]))
    const res = await securityPrReviewService.sync('s1')

    expect(postedComments()).toHaveLength(0)
    expect(res.inline).toBe(0)
    expect(updateReviewLineComment).toHaveBeenCalledTimes(1)
    const [edit] = updateReviewLineComment.mock.calls[0]!
    expect(edit.externalId).toBe(String(thread.id))
    expect(edit.body).toContain(`lumo-security:also:${HUNT_LOGIC_FP}`)
    expect(edit.body).toContain('Exploit paths')
    expect(edit.body.endsWith(fingerprintMarker(THREAD_FP))).toBe(true)
  })

  it('a LOW finding with no thread is still neither posted nor a grouping owner', async () => {
    reconcile.mockResolvedValue(NO_THREADS)
    listReviewComments.mockResolvedValue([])
    repo.findByIdForReview!.mockResolvedValue(scanRow([lowOwner, huntLogic]))
    await securityPrReviewService.sync('s1')

    const comments = postedComments()
    expect(comments).toHaveLength(1)
    expect(comments[0]!.body).toContain(fingerprintMarker(HUNT_LOGIC_FP))
    expect(comments[0]!.body).not.toContain(fingerprintMarker(LOW_FP))
    expect(updateReviewLineComment).not.toHaveBeenCalled()
  })

  it('a LOW finding owning a thread by its own marker is never posted again', async () => {
    reconcile.mockResolvedValue(NO_THREADS)
    listReviewComments.mockResolvedValue([
      { ...thread, body: threadBody.replace(THREAD_FP, LOW_FP) },
    ])
    repo.findByIdForReview!.mockResolvedValue(scanRow([lowOwner, huntLogic]))
    await securityPrReviewService.sync('s1')

    expect(postedComments()).toHaveLength(0)
    expect(updateReviewLineComment).toHaveBeenCalledTimes(1)
    expect(updateReviewLineComment.mock.calls[0]![0].body).toContain(
      `lumo-security:also:${HUNT_LOGIC_FP}`
    )
  })
})
