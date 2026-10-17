/**
 * @jest-environment node
 *
 * LUM-1232 batch G (G2) — commentService.getCommentsWithAuthors labels every
 * author (member name, agent name, @github-login) from the caller workspace.
 */
const mockComments = { findByTaskId: jest.fn() }
const mockActors = { findLabelFieldsByIds: jest.fn() }
const mockProfiles = jest.fn()

jest.mock('@/lib/repositories/comment.repository', () => ({
  get commentRepository() {
    return mockComments
  },
}))
jest.mock('@/lib/repositories/actor.repository', () => ({
  get actorRepository() {
    return mockActors
  },
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: (...a: unknown[]) => mockProfiles(...a),
}))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: {},
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: jest.fn(),
}))
jest.mock('@/lib/integrations/pusher', () => ({ pushTaskEvent: jest.fn() }))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { actorLabel, commentService } from '@/lib/services/comment.service'

beforeEach(() => jest.clearAllMocks())

describe('actorLabel', () => {
  const none = new Map<string, string>()
  it('agent name, then @github login, then member name, else null', () => {
    expect(
      actorLabel(
        {
          type: 'AGENT',
          externalIdentity: null,
          member: null,
          agent: { name: 'Lumo AI' },
        },
        none
      )
    ).toBe('Lumo AI')
    expect(
      actorLabel(
        {
          type: 'GITHUB_USER',
          externalIdentity: 'github:uselumo[bot]',
          member: null,
          agent: null,
        },
        none
      )
    ).toBe('@uselumo[bot]')
    expect(
      actorLabel(
        {
          type: 'MEMBER',
          externalIdentity: null,
          member: { clerkId: 'u1' },
          agent: null,
        },
        new Map([['u1', 'Chao Li']])
      )
    ).toBe('Chao Li')
    expect(
      actorLabel(
        {
          type: 'MEMBER',
          externalIdentity: null,
          member: { clerkId: 'u2' },
          agent: null,
        },
        none
      )
    ).toBeNull()
  })
})

describe('commentService.getCommentsWithAuthors', () => {
  it('adds authorName to comments and replies, looked up in the given workspace', async () => {
    mockComments.findByTaskId.mockResolvedValue([
      {
        id: 'c1',
        authorActorId: 'a_member',
        body: 'hi',
        replies: [{ id: 'c2', authorActorId: 'a_gh', body: 'r' }],
      },
      { id: 'c3', authorActorId: 'a_gone', body: 'x', replies: [] },
    ])
    mockActors.findLabelFieldsByIds.mockResolvedValue([
      {
        id: 'a_member',
        type: 'MEMBER',
        externalIdentity: null,
        member: { clerkId: 'u1' },
        agent: null,
      },
      {
        id: 'a_gh',
        type: 'GITHUB_USER',
        externalIdentity: 'github:octo',
        member: null,
        agent: null,
      },
    ])
    mockProfiles.mockResolvedValue(
      new Map([['u1', { name: 'Chao Li', email: null }]])
    )
    const out = await commentService.getCommentsWithAuthors('task-1', 'ws1')
    expect(mockActors.findLabelFieldsByIds).toHaveBeenCalledWith('ws1', [
      'a_member',
      'a_gh',
      'a_gone',
    ])
    expect(out[0]!.authorName).toBe('Chao Li')
    expect(out[0]!.replies[0]!.authorName).toBe('@octo')
    expect(out[1]!.authorName).toBeNull()
  })

  it('a failed lookup leaves names null instead of failing the read', async () => {
    mockComments.findByTaskId.mockResolvedValue([
      { id: 'c1', authorActorId: 'a1', body: 'hi', replies: [] },
    ])
    mockActors.findLabelFieldsByIds.mockRejectedValue(new Error('db down'))
    const out = await commentService.getCommentsWithAuthors('task-1', 'ws1')
    expect(out[0]!.authorName).toBeNull()
  })
})
