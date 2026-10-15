/**
 * @jest-environment node
 *
 * LUM-1155 — the summary comment's walkthrough shows the scan's call-flow
 * diagram as a Mermaid section next to the changed files; no diagram on
 * the scan (setting off, trivial PR, none drawn) = no section. The comment
 * lists `@uselumo diagram` among Lumo's commands.
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
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
      getPullRequestBody: jest.fn(),
      updatePullRequestBody: jest.fn(),
      listPullRequestFiles: jest.fn(),
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
  },
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
}))
// The request-changes workflow is off: nothing to withdraw on an open PR.
jest.mock('@/ee/security/services/request-changes-off.service', () => ({
  requestChangesOffService: {
    withdrawOnPullRequest: jest.fn().mockResolvedValue(undefined),
  },
}))
// No thread rows: the inline-thread lifecycle has nothing to reconcile.
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
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
  buildSummary,
  commandsBlock,
  clearChangedFilesCache,
  securityPrReviewService,
} from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
const getBody = prCommentClient.getPullRequestBody as jest.Mock
const updateBody = prCommentClient.updatePullRequestBody as jest.Mock
const listFiles = prCommentClient.listPullRequestFiles as jest.Mock

const SHA1 = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD_SLUG = process.env.GITHUB_APP_SLUG

function scanRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    headSha: SHA1,
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    verifierStartedAt: new Date(0),
    verifiedAt: new Date(0),
    findings: [],
    prSummary: {
      intent: 'Adds a retry to the webhook sender.',
      changes: ['Retries failed sends three times'],
    },
    pullRequest: {
      repo: 'acme/app',
      number: 9,
      state: 'open',
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'acme' },
    },
    ...over,
  }
}

function commentBody(): string {
  return createIssue.mock.calls[0]![0].body as string
}

beforeEach(() => {
  jest.clearAllMocks()
  clearChangedFilesCache()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.listReviewComments as jest.Mock).mockResolvedValue([])
  createIssue.mockResolvedValue({ id: 1 })
  ;(prCommentClient.updateIssueComment as jest.Mock).mockResolvedValue({
    id: 1,
  })
  getBody.mockResolvedValue({
    body: 'Why: retries.\n\n@uselumo summary\n\nCloses #4',
    state: 'open',
  })
  updateBody.mockResolvedValue(undefined)
  listFiles.mockResolvedValue([
    {
      filename: 'src/sender.ts',
      status: 'modified',
      additions: 12,
      deletions: 3,
    },
    {
      filename: 'src/new-name.ts',
      status: 'renamed',
      additions: 0,
      deletions: 0,
      previous_filename: 'src/old-name.ts',
    },
  ])
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

const DIAGRAM = {
  participants: ['Webhook', 'Sender', 'GitHub'],
  steps: [
    { from: 0, to: 1, message: 'send(event)', reply: false },
    { from: 1, to: 2, message: 'POST comment', reply: false },
    { from: 1, to: 0, message: 'retried 3 times', reply: true },
  ],
}

describe('LUM-1155 sequence diagram in the walkthrough', () => {
  it('a scan with a diagram: a Mermaid section in the walkthrough, after the changed files', async () => {
    findById.mockResolvedValue(scanRow({ sequenceDiagram: DIAGRAM }))
    await securityPrReviewService.syncReview('s1')
    const body = commentBody()
    const walkthrough = body.slice(
      body.indexOf('<summary>Walkthrough</summary>')
    )
    expect(walkthrough).toContain('**Changed files**')
    expect(walkthrough).toContain(
      [
        '**Sequence diagram**',
        '',
        '```mermaid',
        'sequenceDiagram',
        '    autonumber',
        '    participant P1 as Webhook',
        '    participant P2 as Sender',
        '    participant P3 as GitHub',
        '    P1->>P2: send(event)',
        '    P2->>P3: POST comment',
        '    P2-->>P1: retried 3 times',
        '```',
      ].join('\n')
    )
    expect(walkthrough.indexOf('**Changed files**')).toBeLessThan(
      walkthrough.indexOf('**Sequence diagram**')
    )
  })

  it('no diagram on the scan (setting off, trivial PR): no section', async () => {
    findById.mockResolvedValue(scanRow({ sequenceDiagram: null }))
    await securityPrReviewService.syncReview('s1')
    expect(commentBody()).toContain('<summary>Walkthrough</summary>')
    expect(commentBody()).not.toContain('mermaid')
  })

  it('a stored diagram that does not clean is never posted', async () => {
    findById.mockResolvedValue(
      scanRow({ sequenceDiagram: { participants: ['x'], steps: [] } })
    )
    await securityPrReviewService.syncReview('s1')
    expect(commentBody()).not.toContain('mermaid')
  })

  it('the diagram alone still makes a walkthrough when GitHub does not list the files', async () => {
    listFiles.mockRejectedValue(new Error('boom'))
    findById.mockResolvedValue(scanRow({ sequenceDiagram: DIAGRAM }))
    await securityPrReviewService.syncReview('s1')
    expect(commentBody()).toContain('<summary>Walkthrough</summary>')
    expect(commentBody()).toContain('```mermaid')
    expect(commentBody()).not.toContain('**Changed files**')
  })

  it('the summary comment lists the diagram command', () => {
    expect(commandsBlock('@uselumo')).toContain('`@uselumo diagram`')
  })

  it('buildSummary without a diagram is unchanged (no section)', () => {
    const body = buildSummary({
      headSha: SHA1,
      stages: { secrets: 'RAN' },
      partial: false,
      externalCounts: {},
      open: 0,
      blocking: 0,
      error: null,
      taskUrl: null,
    })
    expect(body).not.toContain('Sequence diagram')
  })
})
