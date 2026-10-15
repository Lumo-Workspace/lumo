/**
 * @jest-environment node
 *
 * LUM-1155 — `@<app> diagram` draws the sequence diagram of the PR's call
 * flow again on request (current setting; refused when off; no model call
 * for a trivial PR; the diff masked before the model sees it), stores the
 * cleaned diagram on the latest review and refreshes the summary comment,
 * whose walkthrough shows it as Mermaid.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/collaborator-access', () => ({
  checkRepositoryWriteAccess: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn().mockResolvedValue({ id: 900 }),
      listIssueCommentsSince: jest.fn().mockResolvedValue([]),
    },
  }
})
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestForDiagram: jest.fn(),
    setSequenceDiagram: jest.fn(),
    findLatestByPullRequestIds: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/ee/security/services/repo-config.service', () => ({
  repoConfigService: {
    sequenceDiagramSettingsForPullRequest: jest.fn(),
  },
}))
jest.mock('@/ee/security/llm/sequence-diagram-client', () => ({
  drawSequenceDiagram: jest.fn(),
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-review-control.service', () => ({
  prReviewControlService: { act: jest.fn() },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findAllowAuthorApproval: jest.fn().mockResolvedValue(true),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  applyPrCommentCommand,
  buildHelpReply,
  diagramCommandOutcome,
  type PrCommentEvent,
} from '@/ee/security/services/pr-command.service'
import { parsePrCommand } from '@/ee/security/services/pr-command-parse'
import {
  buildDiagramCommandReply,
  prSequenceDiagramService,
} from '@/ee/security/services/pr-sequence-diagram.service'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import * as gh from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { repoConfigService } from '@/ee/security/services/repo-config.service'
import * as client from '@/ee/security/llm/sequence-diagram-client'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'

const reply = prCommentClient.createIssueComment as jest.Mock
const latest = prSecurityScanRepository.findLatestForDiagram as jest.Mock
const store = prSecurityScanRepository.setSequenceDiagram as jest.Mock
const settings =
  repoConfigService.sequenceDiagramSettingsForPullRequest as jest.Mock
const draw = client.drawSequenceDiagram as jest.Mock
const sync = securityPrReviewService.sync as jest.Mock

const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD_SLUG = process.env.GITHUB_APP_SLUG
// Built from parts so the fixture itself is not a key-shaped literal.
const KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')

function file(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,0 +1,${lines.length} @@`,
    ...lines.map(l => `+${l}`),
  ].join('\n')
}

const FLOW_DIFF = [
  file(
    'src/api.ts',
    Array.from({ length: 12 }, (_, i) => `const a${i} = ${i}`)
  ),
  file('src/service.ts', [
    `const key = "${KEY}"`,
    ...Array.from({ length: 11 }, (_, i) => `const b${i} = ${i}`),
  ]),
].join('\n')

const DIAGRAM = {
  participants: ['API route', 'Service'],
  steps: [
    { from: 'API route', to: 'Service', message: 'review(pr)' },
    { from: 'Service', to: 'API route', message: 'result', reply: true },
  ],
}

const input = {
  workspaceId: 'w1',
  pullRequestId: 'pr1',
  repo: 'acme/app',
  prNumber: 9,
}

function event(body: string): PrCommentEvent {
  return {
    workspaceId: 'w1',
    pullRequestId: 'pr1',
    repo: 'acme/app',
    prNumber: 9,
    action: 'created',
    comment: {
      id: 556,
      body,
      createdAt: '2026-10-16T08:00:00Z',
      user: { login: 'alice', type: 'User' },
    },
    prAuthorLogin: 'bob',
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  ;(getRepoToken as jest.Mock).mockResolvedValue('token')
  ;(checkRepositoryWriteAccess as jest.Mock).mockResolvedValue('write')
  latest.mockResolvedValue({ id: 's1', headSha: SHA })
  settings.mockResolvedValue({ enabled: true, pathFilters: [] })
  ;(gh.fetchPrHeadSha as jest.Mock).mockResolvedValue(SHA)
  ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(FLOW_DIFF)
  draw.mockResolvedValue(DIAGRAM)
  sync.mockResolvedValue({ posted: true, inline: 0, skipped: 0 })
  store.mockResolvedValue(undefined)
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

describe('parsing and listing', () => {
  it('reads "@uselumo diagram" as the diagram command', () => {
    expect(parsePrCommand('@uselumo diagram', '@uselumo')).toEqual({
      command: 'diagram',
      text: 'diagram',
    })
  })

  it('the help reply lists it', () => {
    expect(buildHelpReply('@uselumo', null)).toContain('`@uselumo diagram`')
  })

  it('maps each result to a recorded outcome', () => {
    expect(diagramCommandOutcome('off')).toBe('refused_mode_off')
    expect(diagramCommandOutcome('no_review')).toBe('refused_unreviewed')
    expect(diagramCommandOutcome('stale')).toBe('refused_unreviewed')
    expect(diagramCommandOutcome('failed')).toBe('failed')
    expect(diagramCommandOutcome('drawn')).toBe('done')
    expect(diagramCommandOutcome('trivial')).toBe('done')
    expect(diagramCommandOutcome('none')).toBe('done')
  })
})

describe('prSequenceDiagramService.regenerate', () => {
  it('draws, stores the cleaned diagram on the latest review and refreshes the summary comment', async () => {
    const r = await prSequenceDiagramService.regenerate(input)
    expect(r).toEqual({ kind: 'drawn', sha: SHA, posted: true })
    expect(store).toHaveBeenCalledWith('s1', {
      participants: ['API route', 'Service'],
      steps: [
        { from: 0, to: 1, message: 'review(pr)', reply: false },
        { from: 1, to: 0, message: 'result', reply: true },
      ],
    })
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('a redraw whose calls all come back marked reply stores them as calls (probe #58)', async () => {
    draw.mockResolvedValue({
      participants: ['API route', 'Service', 'Store'],
      steps: [
        {
          from: 'API route',
          to: 'Service',
          message: 'review(pr)',
          reply: true,
        },
        { from: 'Service', to: 'Store', message: 'load(pr)', reply: true },
      ],
    })
    await prSequenceDiagramService.regenerate(input)
    const saved = store.mock.calls[0]![1] as {
      steps: Array<{ reply: boolean }>
    }
    expect(saved.steps.map(s => s.reply)).toEqual([false, false])
  })

  it('masks secrets in the diff before the model sees it', async () => {
    await prSequenceDiagramService.regenerate(input)
    const sent = draw.mock.calls[0]![0] as { diff: { text: string } }
    expect(sent.diff.text).toContain('src/service.ts')
    expect(sent.diff.text).not.toContain(KEY)
  })

  it('setting off: refused, no model call, nothing stored', async () => {
    settings.mockResolvedValue({ enabled: false, pathFilters: [] })
    expect(await prSequenceDiagramService.regenerate(input)).toEqual({
      kind: 'off',
    })
    expect(draw).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
  })

  it('a trivial PR: no model call', async () => {
    ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(
      file('src/api.ts', ['const a = 1'])
    )
    expect(await prSequenceDiagramService.regenerate(input)).toEqual({
      kind: 'trivial',
      sha: SHA,
    })
    expect(draw).not.toHaveBeenCalled()
  })

  it('path filters apply: filtered-out files do not count', async () => {
    settings.mockResolvedValue({ enabled: true, pathFilters: ['!src/api.ts'] })
    expect((await prSequenceDiagramService.regenerate(input)).kind).toBe(
      'trivial'
    )
  })

  it('never reviewed / reviewed an older head: refused', async () => {
    latest.mockResolvedValueOnce(null)
    expect(await prSequenceDiagramService.regenerate(input)).toEqual({
      kind: 'no_review',
    })
    ;(gh.fetchPrHeadSha as jest.Mock).mockResolvedValueOnce('f'.repeat(40))
    expect((await prSequenceDiagramService.regenerate(input)).kind).toBe(
      'stale'
    )
    expect(draw).not.toHaveBeenCalled()
  })

  it('no usable flow from the model: nothing stored', async () => {
    draw.mockResolvedValue(null)
    expect(await prSequenceDiagramService.regenerate(input)).toEqual({
      kind: 'none',
      sha: SHA,
    })
    expect(store).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
  })

  it('a failing model call is a reply, never a throw', async () => {
    draw.mockRejectedValue(new Error('gateway down'))
    expect(await prSequenceDiagramService.regenerate(input)).toEqual({
      kind: 'failed',
    })
  })
})

describe('the command end to end', () => {
  it('replies with where the diagram went', async () => {
    await applyPrCommentCommand(event('@uselumo diagram'))
    expect(store).toHaveBeenCalled()
    const body = (reply.mock.calls[0]![0] as { body: string }).body
    expect(body).toContain('sequence diagram')
    expect(body).toContain(SHA.slice(0, 7))
  })

  it('replies that diagrams are off', async () => {
    settings.mockResolvedValue({ enabled: false, pathFilters: [] })
    await applyPrCommentCommand(event('@uselumo diagram'))
    const body = (reply.mock.calls[0]![0] as { body: string }).body
    expect(body).toContain('turned off')
    expect(draw).not.toHaveBeenCalled()
  })
})

describe('buildDiagramCommandReply', () => {
  it('words every result', () => {
    for (const r of [
      { kind: 'off' },
      { kind: 'no_review' },
      { kind: 'stale', sha: SHA },
      { kind: 'trivial', sha: SHA },
      { kind: 'none', sha: SHA },
      { kind: 'failed' },
      { kind: 'drawn', sha: SHA, posted: true },
      { kind: 'drawn', sha: SHA, posted: false },
    ] as const)
      expect(buildDiagramCommandReply(r, '@uselumo').length).toBeGreaterThan(20)
  })
})
