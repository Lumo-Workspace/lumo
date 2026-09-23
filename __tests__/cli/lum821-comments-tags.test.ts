/**
 * @jest-environment node
 *
 * LUM-821 P1: `task comment --reply-to`, `task comments edit/rm`, comment
 * short ids in the thread, and `lumo tag list/create`.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import { taskComment } from '@/cli/src/commands/task-comment'
import {
  taskCommentEdit,
  taskCommentRm,
} from '@/cli/src/commands/task-comment-manage'
import { formatCommentThread } from '@/cli/src/commands/task-comment-list'
import { pickComment } from '@/cli/src/lib/comment-ref'
import { formatTagList, tagCreate, tagList } from '@/cli/src/commands/tag'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'

const THREAD = [
  {
    id: 'cmaaaaaa1111',
    authorActorId: 'a1',
    body: '<p>Top level</p>',
    createdAt: '2026-09-23T00:00:00Z',
    replies: [
      {
        id: 'cmbbbbbb2222',
        authorActorId: 'a2',
        body: '<p>A reply</p>',
        createdAt: '2026-09-23T01:00:00Z',
      },
    ],
  },
  {
    id: 'cmaaaab3333',
    authorActorId: 'a1',
    body: '<p>Second</p>',
    createdAt: '2026-09-23T02:00:00Z',
    replies: [],
  },
]

let out: string
let err: string
let fetchMock: jest.Mock
beforeEach(() => {
  out = ''
  err = ''
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status })
    if (u.endsWith('/api/tasks/resolve/LUM-7'))
      return json({ id: 'task-7', identifier: 'LUM-7' })
    if (u.endsWith('/api/tasks/task-7/comments') && method === 'GET')
      return json({ comments: THREAD })
    if (u.endsWith('/api/tasks/task-7/comments') && method === 'POST')
      return json({ comment: { id: 'cmnew' } }, 201)
    if (u.includes('/api/tasks/task-7/comments/') && method === 'PATCH')
      return json({ comment: { id: 'x' } })
    if (u.includes('/api/tasks/task-7/comments/') && method === 'DELETE')
      return json({ success: true })
    if (u.endsWith('/api/tags') && method === 'GET')
      return json({
        tags: [
          { id: 't2', name: 'ux', color: null, taskCount: 1, documentCount: 0 },
          {
            id: 't1',
            name: 'bug',
            color: '#ff0000',
            taskCount: 3,
            documentCount: 2,
          },
        ],
      })
    if (u.endsWith('/api/tags') && method === 'POST')
      return json({ tag: { id: 't9', name: 'infra' } }, 201)
    throw new Error(`unexpected ${method} ${u}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

const calls = (method: string) =>
  fetchMock.mock.calls.filter(c => (c[1]?.method ?? 'GET') === method)

describe('comment short ids', () => {
  it('thread lines carry #<8-char id>', () => {
    const text = formatCommentThread(THREAD, { full: true })
    expect(text).toContain('#cmaaaaaa · a1 ·')
    expect(text).toContain('  #cmbbbbbb · a2 ·')
  })
  it('pickComment: unique prefix ok, ambiguous / too short refused, replies flagged', () => {
    expect(pickComment(THREAD, '#cmaaaaaa1')).toMatchObject({
      ok: true,
      isReply: false,
    })
    expect(pickComment(THREAD, 'cmbbbb')).toMatchObject({
      ok: true,
      isReply: true,
    })
    expect(pickComment(THREAD, 'cmaaaa').ok).toBe(false) // matches two
    expect(pickComment(THREAD, 'cma').ok).toBe(false) // too short
  })
})

describe('task comment --reply-to', () => {
  it('posts with parentId of the picked top-level comment', async () => {
    expect(
      await taskComment('LUM-7', 'ack', { replyTo: 'cmaaaaaa' })
    ).toBeUndefined()
    const post = calls('POST')[0]!
    expect(JSON.parse(String(post[1].body))).toEqual({
      body: 'ack',
      parentId: 'cmaaaaaa1111',
    })
    expect(out).toContain('Replied on LUM-7 to #cmaaaaaa')
  })
  it('refuses to reply to a reply and names the top-level comment', async () => {
    expect(await taskComment('LUM-7', 'ack', { replyTo: 'cmbbbbbb' })).toBe(1)
    expect(calls('POST')).toHaveLength(0)
    expect(err).toContain('reply to #cmaaaaaa instead')
  })
})

describe('task comments edit / rm', () => {
  it('edit PATCHes the resolved comment', async () => {
    const code = await taskCommentEdit('LUM-7', 'cmaaaab3', 'fixed')
    expect(err).toBe('')
    expect(code).toBeUndefined()
    const patch = calls('PATCH')[0]!
    expect(String(patch[0])).toMatch(/\/comments\/cmaaaab3333$/)
    expect(JSON.parse(String(patch[1].body))).toEqual({ body: 'fixed' })
  })

  it('rm without --confirm exits 4 with an envelope and deletes nothing', async () => {
    const code = await taskCommentRm('LUM-7', 'cmaaaaaa', {})
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(calls('DELETE')).toHaveLength(0)
    const env = JSON.parse(out)
    expect(env.status).toBe('confirmation_required')
    expect(env.changes[0]).toContain(
      'Will delete comment #cmaaaaaa on LUM-7: "Top level"'
    )
    expect(env.changes[1]).toContain('1 reply is hidden with it')
    expect(env.confirmCommand).toContain('--confirm')
  })

  it('rm --confirm sends the DELETE', async () => {
    expect(
      await taskCommentRm('LUM-7', 'cmaaaaaa', { confirm: true })
    ).toBeUndefined()
    expect(String(calls('DELETE')[0]![0])).toMatch(/\/comments\/cmaaaaaa1111$/)
  })
})

describe('lumo tag list / create', () => {
  it('lists tags sorted by name with color and usage', async () => {
    await tagList()
    const lines = out.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^bug\s+#ff0000\s+3 tasks\s+2 docs$/)
    expect(lines[1]).toMatch(/^ux\s+-\s+1 task\s+0 docs$/)
  })
  it('create posts name + color', async () => {
    expect(await tagCreate('infra', { color: '#00ff00' })).toBeUndefined()
    expect(JSON.parse(String(calls('POST')[0]![1].body))).toEqual({
      name: 'infra',
      color: '#00ff00',
    })
  })
  it('create validates color / length before any network call', async () => {
    expect(await tagCreate('x', { color: 'red' })).toBe(1)
    expect(await tagCreate('y'.repeat(31))).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('empty list reads "No tags."', () => {
    expect(formatTagList([])).toBe('No tags.')
  })
})
