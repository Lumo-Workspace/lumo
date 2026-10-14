/**
 * @jest-environment node
 *
 * LUM-1127 — `pull_request_review_thread` reaches the plugins as
 * `github.reviewThread`, on both deliveries; the App copy is never skipped
 * for a workspace with an OAuth repo hook, because that hook does not
 * subscribe to review threads.
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
import { emitCoreEvent } from '@/lib/plugins/events'

const verify = verifyGitHubSignature as jest.Mock
const emit = emitCoreEvent as jest.Mock

function makeRequest(event: string, body: object) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' },
    body: JSON.stringify(body),
  })
}

const payload = {
  action: 'resolved',
  pull_request: { number: 9 },
  repository: { full_name: 'acme/app' },
  installation: { id: 42 },
  thread: {
    node_id: 'PRRT_1',
    comments: [
      {
        id: 101,
        body: 'x <!-- lumo-security:fp:fp1 -->',
        user: { type: 'Bot', login: 'uselumo[bot]' },
        in_reply_to_id: null,
      },
    ],
  },
  sender: { login: 'alice', type: 'User' },
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'app-secret'
  ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue({
    id: 'pr1',
    taskId: null,
    workspaceId: 'w1',
  })
  ;(githubService.findWebhooksByRepo as jest.Mock).mockResolvedValue([
    {
      integration: {
        webhookSecret: 'repo-secret',
        workspaceId: 'w1',
        id: 'i1',
      },
    },
  ])
})

describe('pull_request_review_thread', () => {
  it('repo-hook delivery: emits github.reviewThread with the thread, comments and sender (any PR row, task or not)', async () => {
    verify.mockReturnValue(true)
    const res = await POST(makeRequest('pull_request_review_thread', payload))
    expect(res.status).toBe(200)
    expect(emit).toHaveBeenCalledWith('github.reviewThread', {
      workspaceId: 'w1',
      pullRequestId: 'pr1',
      action: 'resolved',
      threadNodeId: 'PRRT_1',
      comments: [
        {
          id: 101,
          body: 'x <!-- lumo-security:fp:fp1 -->',
          user: { type: 'Bot', login: 'uselumo[bot]' },
          in_reply_to_id: null,
        },
      ],
      sender: { login: 'alice', type: 'User' },
    })
  })

  it('App delivery is handled even for a workspace whose OAuth repo hook exists', async () => {
    verify.mockImplementation(
      (_b: string, _s: string, secret: string) => secret === 'app-secret'
    )
    await POST(makeRequest('pull_request_review_thread', payload))
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('other repo events keep the App-copy skip for a hooked workspace', async () => {
    verify.mockImplementation(
      (_b: string, _s: string, secret: string) => secret === 'app-secret'
    )
    await POST(
      makeRequest('pull_request_review', {
        action: 'submitted',
        pull_request: { number: 9 },
        repository: { full_name: 'acme/app' },
        installation: { id: 42 },
      })
    )
    expect(pullRequestRepository.findByRepoAndNumber).not.toHaveBeenCalled()
  })

  it('an unknown PR emits nothing', async () => {
    verify.mockReturnValue(true)
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      null
    )
    await POST(makeRequest('pull_request_review_thread', payload))
    expect(emit).not.toHaveBeenCalled()
  })
})
