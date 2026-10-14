/**
 * @jest-environment node
 *
 * LUM-1129 — a PR conversation comment reaches the plugins as
 * `github.issueComment` for ANY PR row Lumo holds (task-linked or not), so
 * `@<app> review` works on a PR with no task. The task mirror keeps its
 * task-only path; a comment on a PR Lumo does not hold is dropped.
 */
jest.mock('@/lib/services/github.service')
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn(),
}))
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    isRepositoryConfirmed: jest.fn().mockResolvedValue(true),
    resolveWorkspacesForRepository: jest.fn().mockResolvedValue(['w1']),
  },
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
jest.mock('@/lib/plugins/events', () => ({ emitCoreEvent: jest.fn() }))
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { emitCoreEvent } from '@/lib/plugins/events'

const verify = verifyGitHubSignature as jest.Mock
const emit = emitCoreEvent as jest.Mock
const findPr = pullRequestRepository.findByRepoAndNumber as jest.Mock
const mirror = prCommentMirrorService.runInbound as jest.Mock

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: {
      'x-github-event': 'issue_comment',
      'x-hub-signature-256': 'sha256=',
    },
    body: JSON.stringify(body),
  })
}

const payload = {
  action: 'created',
  issue: {
    number: 9,
    pull_request: { url: 'x' },
    user: { login: 'author', type: 'User' },
  },
  comment: {
    id: 555,
    body: '@uselumo pause',
    created_at: '2026-10-14T08:00:00Z',
    user: { login: 'alice', type: 'User' },
  },
  repository: { full_name: 'acme/app' },
  installation: { id: 42 },
  sender: { login: 'alice', type: 'User' },
}

beforeEach(() => {
  jest.clearAllMocks()
  verify.mockReturnValue(true)
  ;(githubService.findWebhooksByRepo as jest.Mock).mockResolvedValue([
    {
      integration: { webhookSecret: 's', workspaceId: 'w1', id: 'i1' },
    },
  ])
})

describe('issue_comment → github.issueComment', () => {
  it('emits for a PR with no task, and skips the task mirror', async () => {
    findPr.mockResolvedValue({ id: 'pr1', taskId: null })
    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(200)
    expect(emit).toHaveBeenCalledWith('github.issueComment', {
      workspaceId: 'w1',
      pullRequestId: 'pr1',
      repo: 'acme/app',
      prNumber: 9,
      action: 'created',
      comment: {
        id: 555,
        body: '@uselumo pause',
        createdAt: '2026-10-14T08:00:00Z',
        user: { login: 'alice', type: 'User' },
      },
      prAuthorLogin: 'author',
    })
    expect(mirror).not.toHaveBeenCalled()
  })

  it('emits and still mirrors for a task-linked PR', async () => {
    findPr.mockResolvedValue({ id: 'pr1', taskId: 't1' })
    await POST(makeRequest({ ...payload, action: 'edited' }))
    expect(emit).toHaveBeenCalledWith(
      'github.issueComment',
      expect.objectContaining({ action: 'edited' })
    )
    expect(mirror).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', pullRequestId: 'pr1' })
    )
  })

  it('a PR Lumo does not hold emits nothing', async () => {
    findPr.mockResolvedValue(null)
    await POST(makeRequest(payload))
    expect(emit).not.toHaveBeenCalled()
    expect(mirror).not.toHaveBeenCalled()
  })

  it('a comment on a plain issue (not a PR) is not looked up', async () => {
    await POST(
      makeRequest({ ...payload, issue: { number: 9, user: { login: 'a' } } })
    )
    expect(findPr).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
