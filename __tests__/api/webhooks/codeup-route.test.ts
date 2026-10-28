/**
 * @jest-environment node
 *
 * LUM-1315 — POST /api/webhooks/codeup end to end through the real webhook
 * service, with the repositories mocked. Payloads are the fixtures recorded
 * from Alibaba Cloud's documented Codeup webhook samples.
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/repositories/codeup.repository', () => ({
  codeupRepository: {
    findDeliveryCandidates: jest.fn(),
    findOtherConfirmingWorkspaceIds: jest.fn(),
    upsertMergeRequest: jest.fn(),
    upsertTaskBranch: jest.fn(),
    findMergeRequestHead: jest.fn(),
  },
}))
// LUM-1316: the core event the security plugin reviews on.
jest.mock('@/lib/plugins/events', () => ({ emitCoreEvent: jest.fn() }))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findTaskByIdentifier: jest.fn(),
    findOtherWorkspaceIdsWithTask: jest.fn(),
  },
}))

import mergeRequestHook from '../../fixtures/codeup/merge-request-hook.json'
import pushHook from '../../fixtures/codeup/push-hook.json'
import { POST } from '@/app/api/webhooks/codeup/route'
import { hashWebhookToken } from '@/lib/integrations/codeup/webhook'
import { codeupRepository } from '@/lib/repositories/codeup.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { emitCoreEvent } from '@/lib/plugins/events'

const codeup = codeupRepository as jest.Mocked<typeof codeupRepository>
const github = githubRepository as jest.Mocked<typeof githubRepository>

const WS = 'ws-dog'
const TOKEN = 'a'.repeat(64)
const PATH = '60de7a6852743a5162b5f957/demo'

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: 'cr-1',
    repositoryId: 14,
    pathWithNamespace: PATH,
    webhookTokenHash: hashWebhookToken(TOKEN),
    confirmedAt: new Date('2026-10-25T00:00:00Z'),
    workspaceId: WS,
    ...over,
  }
}

const TASK = {
  id: 'task-12',
  number: 12,
  title: 'Add login',
  status: 'IN_PROGRESS',
  projectId: 'p1',
  assigneeActorId: null,
  project: { name: 'Lumo', ownerId: null, workspaceId: WS },
  team: { identifier: 'LUM' },
}

function post(
  body: unknown,
  headers: Record<string, string | undefined> = {}
): Promise<Response> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  for (const [k, v] of Object.entries(headers)) if (v) h[k] = v
  return POST(
    new NextRequest('http://x/api/webhooks/codeup', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: h,
    })
  )
}

const mrHeaders = {
  'codeup-event': 'Merge Request Hook',
  'x-codeup-token': TOKEN,
}
const pushHeaders = { 'codeup-event': 'Push Hook', 'x-codeup-token': TOKEN }

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...OLD_ENV, LUMO_DOGFOOD_WORKSPACE_IDS: WS }
  codeup.findDeliveryCandidates.mockResolvedValue([candidate()])
  codeup.findOtherConfirmingWorkspaceIds.mockResolvedValue([])
  codeup.upsertMergeRequest.mockResolvedValue({ id: 'pr-1', taskId: 'task-12' })
  codeup.findMergeRequestHead.mockResolvedValue(null)
  github.findTaskByIdentifier.mockResolvedValue(TASK as never)
  github.findOtherWorkspaceIdsWithTask.mockResolvedValue([])
})
afterAll(() => {
  process.env = OLD_ENV
})

describe('authentication and rollout', () => {
  it('401s without X-Codeup-Token', async () => {
    const res = await post(mergeRequestHook, {
      'codeup-event': 'Merge Request Hook',
    })
    expect(res.status).toBe(401)
    expect(codeup.upsertMergeRequest).not.toHaveBeenCalled()
  })

  it('401s with a wrong token', async () => {
    const res = await post(mergeRequestHook, {
      ...mrHeaders,
      'x-codeup-token': 'b'.repeat(64),
    })
    expect(res.status).toBe(401)
    expect(codeup.upsertMergeRequest).not.toHaveBeenCalled()
  })

  it('401s for a repository no workspace has a hook on', async () => {
    codeup.findDeliveryCandidates.mockResolvedValue([])
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(401)
  })

  it('404s when the flag is off for the workspace', async () => {
    process.env = { ...OLD_ENV, LUMO_DOGFOOD_WORKSPACE_IDS: 'someone-else' }
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(404)
    expect(codeup.upsertMergeRequest).not.toHaveBeenCalled()
  })

  it('ignores (2xx) a delivery for a repository that is no longer confirmed', async () => {
    codeup.findDeliveryCandidates.mockResolvedValue([
      candidate({ confirmedAt: null }),
    ])
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, outcome: 'ignored' })
    expect(codeup.upsertMergeRequest).not.toHaveBeenCalled()
  })

  it('400s on a body that is not JSON', async () => {
    const res = await post('not json', mrHeaders)
    expect(res.status).toBe(400)
  })

  it('routes to the workspace whose own hook token matches (LUM-924)', async () => {
    codeup.findDeliveryCandidates.mockResolvedValue([
      candidate({
        id: 'cr-other',
        workspaceId: 'ws-other',
        webhookTokenHash: hashWebhookToken('c'.repeat(64)),
      }),
      candidate(),
    ])
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(200)
    expect(codeup.upsertMergeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS })
    )
  })
})

describe('Merge Request Hook', () => {
  it('upserts a codeup PR row linked to the task named by the source branch', async () => {
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, outcome: 'handled' })

    expect(github.findTaskByIdentifier).toHaveBeenCalledWith('LUM', 12, WS)
    expect(codeup.upsertMergeRequest).toHaveBeenCalledWith({
      workspaceId: WS,
      taskId: 'task-12',
      repo: PATH,
      number: 1,
      title: 'MS-Viewport',
      url: 'https://codeup.aliyun.com/demo/demo/merge_requests/1',
      state: 'open',
      authorLogin: 'codeup',
      headBranch: 'lumo/LUM-12-add-login',
      headSha: 'da1560886d4f094c3e6c9ef40349f7d38b5d27d7',
      baseBranch: 'master',
      isDraft: false,
      mergedAt: null,
      closedAt: null,
    })
    expect(codeup.upsertTaskBranch).toHaveBeenCalledWith({
      taskId: 'task-12',
      repo: PATH,
      branchName: 'lumo/LUM-12-add-login',
    })
  })

  it('records merged and closed states with their timestamps', async () => {
    const merged = {
      ...mergeRequestHook,
      object_attributes: {
        ...mergeRequestHook.object_attributes,
        state: 'merged',
        action: 'merge',
      },
    }
    await post(merged, mrHeaders)
    expect(codeup.upsertMergeRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'merged',
        mergedAt: new Date('2013-12-03T17:23:34Z'),
        closedAt: new Date('2013-12-03T17:23:34Z'),
      })
    )

    const closed = {
      ...mergeRequestHook,
      object_attributes: {
        ...mergeRequestHook.object_attributes,
        state: 'closed',
        action: 'close',
      },
    }
    await post(closed, mrHeaders)
    expect(codeup.upsertMergeRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'closed', mergedAt: null })
    )
  })

  it('keeps an unlinked MR unlinked when the branch names no task', async () => {
    codeup.upsertMergeRequest.mockResolvedValue({ id: 'pr-1', taskId: null })
    const body = {
      ...mergeRequestHook,
      object_attributes: {
        ...mergeRequestHook.object_attributes,
        source_branch: 'feature/no-task',
      },
    }
    const res = await post(body, mrHeaders)
    expect(res.status).toBe(200)
    expect(codeup.upsertMergeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null })
    )
    expect(codeup.upsertTaskBranch).not.toHaveBeenCalled()
  })

  it('does not link a branch whose task id another confirming workspace also has (LUM-925)', async () => {
    codeup.findOtherConfirmingWorkspaceIds.mockResolvedValue(['ws-2'])
    github.findOtherWorkspaceIdsWithTask.mockResolvedValue(['ws-2'])
    codeup.upsertMergeRequest.mockResolvedValue({ id: 'pr-1', taskId: null })
    await post(mergeRequestHook, mrHeaders)
    expect(codeup.upsertMergeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null })
    )
  })

  it('answers 200 and logs when a handler fails', async () => {
    codeup.upsertMergeRequest.mockRejectedValue(new Error('db down'))
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(200)
  })
})

describe('LUM-1316 Merge Request Hook → git.pullRequest (Lumo review)', () => {
  const emitted = () => (emitCoreEvent as jest.Mock).mock.calls
  const HEAD = mergeRequestHook.object_attributes.last_commit.id
  const update = (headId = HEAD) => ({
    ...mergeRequestHook,
    object_attributes: {
      ...mergeRequestHook.object_attributes,
      action: 'update',
      last_commit: {
        ...mergeRequestHook.object_attributes.last_commit,
        id: headId,
      },
    },
  })

  it('an opened, task-linked MR emits git.pullRequest (provider codeup, action opened)', async () => {
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(200)
    expect(emitted()).toEqual([
      [
        'git.pullRequest',
        {
          provider: 'codeup',
          workspaceId: WS,
          taskId: 'task-12',
          pullRequestId: 'pr-1',
          action: 'opened',
          state: 'open',
          repo: PATH,
          prNumber: 1,
          isDraft: false,
        },
      ],
    ])
  })

  it('a push (new head) is synchronize; the same head again is an edit, not a push', async () => {
    codeup.findMergeRequestHead.mockResolvedValue('0'.repeat(40))
    await post(update(), mrHeaders)
    expect(emitted()[0]![1]).toMatchObject({ action: 'synchronize' })

    jest.clearAllMocks()
    codeup.findMergeRequestHead.mockResolvedValue(HEAD)
    codeup.upsertMergeRequest.mockResolvedValue({
      id: 'pr-1',
      taskId: 'task-12',
    })
    await post(update(), mrHeaders)
    expect(emitted()[0]![1]).toMatchObject({ action: 'edited' })
  })

  it('a task-less MR emits nothing (not offered to the automatic review)', async () => {
    codeup.upsertMergeRequest.mockResolvedValue({ id: 'pr-1', taskId: null })
    github.findTaskByIdentifier.mockResolvedValue(null)
    await post(mergeRequestHook, mrHeaders)
    expect(emitCoreEvent).not.toHaveBeenCalled()
  })

  it('flag off: 404, nothing stored, nothing emitted — no scan', async () => {
    process.env = { ...OLD_ENV, LUMO_DOGFOOD_WORKSPACE_IDS: 'other-ws' }
    const res = await post(mergeRequestHook, mrHeaders)
    expect(res.status).toBe(404)
    expect(codeup.upsertMergeRequest).not.toHaveBeenCalled()
    expect(emitCoreEvent).not.toHaveBeenCalled()
  })
})

describe('Push Hook', () => {
  it('upserts the task branch with its head commit', async () => {
    const res = await post(pushHook, pushHeaders)
    expect(res.status).toBe(200)
    expect(codeup.upsertTaskBranch).toHaveBeenCalledWith({
      taskId: 'task-12',
      repo: PATH,
      branchName: 'lumo/LUM-12-add-login',
      lastCommitSha: 'eb63d0277e64684236ebf8394b919230c4b8a286',
      lastCommitMessage: 'fixed readme',
      lastCommitAuthor: 'Lumo Dev',
      lastPushedAt: expect.any(Date),
    })
  })

  it('ignores a push to a branch that names no task', async () => {
    github.findTaskByIdentifier.mockResolvedValue(null)
    const res = await post(pushHook, pushHeaders)
    expect(await res.json()).toEqual({ ok: true, outcome: 'ignored' })
    expect(codeup.upsertTaskBranch).not.toHaveBeenCalled()
  })

  it('ignores events Lumo does not read', async () => {
    const res = await post(pushHook, {
      ...pushHeaders,
      'codeup-event': 'Tag Push Hook',
    })
    expect(await res.json()).toEqual({ ok: true, outcome: 'ignored' })
  })
})
