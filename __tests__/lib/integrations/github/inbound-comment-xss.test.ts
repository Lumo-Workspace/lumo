/**
 * @jest-environment node
 */
/**
 * LUM-921: a GitHub user who can comment on a linked PR controls the body
 * (and, for review-line comments, the path/URL in the header). The mirrored
 * Comment.body must come out with nothing executable in it.
 */
import { parse } from 'node-html-parser'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/repositories/github.repository')
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForComment: jest.fn() },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/services/github-actor.service', () => ({
  githubActorService: {
    upsertPseudoActor: jest.fn().mockResolvedValue({ id: 'gh-actor' }),
  },
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { notifyMentionsForMirror: jest.fn() },
}))

import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import {
  HEADER_MARKER_CLOSE,
  HEADER_MARKER_OPEN,
} from '@/lib/integrations/github/markdown-bridge'

const ATTACK = [
  'looks fine <img src=x onerror="alert(document.cookie)">',
  '<svg onload=alert(1)></svg><script>alert(2)</script>',
  '<a href="javascript:alert(3)">click</a> <iframe src="https://evil.test"></iframe>',
].join('\n\n')

const user = { id: 7, login: 'mallory', type: 'User', avatar_url: '' }

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    node_id: 'N_101',
    html_url: 'https://github.com/foo/bar/pull/1#discussion_r101',
    body: ATTACK,
    updated_at: '2026-09-30T00:00:00Z',
    user,
    ...overrides,
  }
}

/** Every way stored HTML could execute on render. */
function executableBits(html: string): string[] {
  const found: string[] = []
  for (const el of parse(html).querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase()
    if (['script', 'svg', 'iframe', 'object', 'embed'].includes(tag))
      found.push(`<${tag}>`)
    for (const [name, value] of Object.entries(el.attributes)) {
      if (/^on/i.test(name)) found.push(`${tag}[${name}]`)
      if (/^(href|src)$/i.test(name) && !/^https:\/\//i.test(value))
        found.push(`${tag}[${name}=${value}]`)
    }
  }
  return found
}

function storedBody(): string {
  const create = commentRepository.create as jest.Mock
  const update = commentRepository.update as jest.Mock
  const last = (calls: unknown[][]) => calls[calls.length - 1]
  const call = (last(create.mock.calls) ?? last(update.mock.calls)) as
    | unknown[]
    | undefined
  const arg = (i: number) => call?.[i] as { body?: string } | undefined
  return (arg(0)?.body ?? arg(1)?.body) as string
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(
    prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
  ).mockResolvedValue([])
  ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
    null
  )
  ;(
    prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
  ).mockResolvedValue(null)
  ;(githubRepository.findIntegrationByLogin as jest.Mock).mockResolvedValue(
    null
  )
  ;(commentRepository.create as jest.Mock).mockResolvedValue({ id: 'c1' })
})

const base = {
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
}

describe('inbound GitHub comment stores no executable markup', () => {
  it('issue comment: HTML in the body lands as escaped text', async () => {
    await prCommentMirrorService.runInbound({
      ...base,
      event: 'issue_comment',
      action: 'created',
      raw: { comment: node() },
    })
    const body = storedBody()
    expect(executableBits(body)).toEqual([])
    // Visible as text, not dropped: the reader still sees what was written.
    expect(parse(body).textContent).toContain('<img src=x onerror=')
    expect(body).toContain('<p>looks fine &lt;img')
  })

  it('review summary: header marker survives, body is inert', async () => {
    await prCommentMirrorService.runInbound({
      ...base,
      event: 'pull_request_review',
      action: 'submitted',
      raw: { review: { ...node(), state: 'changes_requested' } },
    })
    const body = storedBody()
    expect(executableBits(body)).toEqual([])
    expect(
      body.startsWith(
        `${HEADER_MARKER_OPEN}🛑 Requested changes${HEADER_MARKER_CLOSE}`
      )
    ).toBe(true)
  })

  it('review-line comment: HTML in path is escaped and a non-https url is not linked', async () => {
    await prCommentMirrorService.runInbound({
      ...base,
      event: 'pull_request_review_comment',
      action: 'created',
      raw: {
        comment: node({
          path: 'src/<img src=x onerror=alert(4)>.ts',
          line: 12,
          html_url: 'javascript:alert(5)',
        }),
      },
    })
    const body = storedBody()
    expect(executableBits(body)).toEqual([])
    expect(parse(body).querySelectorAll('a')).toHaveLength(0)
    expect(parse(body).textContent).toContain(
      'src/<img src=x onerror=alert(4)>.ts:12'
    )
  })

  it('review-line comment: an https url is still linked', async () => {
    await prCommentMirrorService.runInbound({
      ...base,
      event: 'pull_request_review_comment',
      action: 'created',
      raw: { comment: node({ path: 'a.ts', line: 3, body: 'nit' }) },
    })
    expect(storedBody()).toBe(
      `${HEADER_MARKER_OPEN}📍 在 <a href="https://github.com/foo/bar/pull/1#discussion_r101">a.ts:3</a> 评论${HEADER_MARKER_CLOSE}<p>nit</p>`
    )
  })

  it('edited comment: the update path is sanitized too', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue({
      id: 'm1',
      commentId: 'c1',
      externalUpdatedAt: new Date('2026-09-01T00:00:00Z'),
    })
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      deletedAt: null,
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    })
    await prCommentMirrorService.runInbound({
      ...base,
      event: 'issue_comment',
      action: 'edited',
      raw: { comment: node() },
    })
    expect(commentRepository.update).toHaveBeenCalled()
    expect(executableBits(storedBody())).toEqual([])
  })

  it('plain text keeps its paragraphs and line breaks', async () => {
    await prCommentMirrorService.runInbound({
      ...base,
      event: 'issue_comment',
      action: 'created',
      raw: { comment: node({ body: 'a & b\nline 2\n\nnext para' }) },
    })
    expect(storedBody()).toBe('<p>a &amp; b<br />line 2</p><p>next para</p>')
  })
})
