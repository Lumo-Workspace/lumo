/**
 * LUM-1238: PR-mirrored / bot comments (`@uselumo[bot]`, `@vercel[bot]`) have
 * a non-member `authorActorId`; the web must show the API's `authorName`
 * instead of a hardcoded "Unknown".
 */
import { resolveCommentAuthor } from '@/app/workspace/[workspaceUrl]/components/comment-utils'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

const FALLBACK = 'Unknown author (localized)'

const member: WorkspaceMemberInfo = {
  id: 'm1',
  clerkId: 'clerk_1',
  role: 'MEMBER',
  name: 'Chao Li',
  email: null,
  imageUrl: 'https://img.example/chao.png',
  joinedAt: '2026-01-01T00:00:00.000Z',
  actorId: 'actor-member',
} as WorkspaceMemberInfo

describe('resolveCommentAuthor (LUM-1238)', () => {
  it('shows the API authorName for a non-member actor (PR-mirrored bot comment)', () => {
    const a = resolveCommentAuthor(
      {
        type: 'USER',
        authorActorId: 'actor-gh-bot',
        authorName: '@uselumo[bot]',
      },
      [member],
      [],
      FALLBACK
    )
    expect(a.name).toBe('@uselumo[bot]')
    expect(a.isAgent).toBe(false)
    expect(a.imageUrl).toBeUndefined()
  })

  it('prefers the workspace member (current name + avatar) over authorName', () => {
    const a = resolveCommentAuthor(
      { type: 'USER', authorActorId: 'actor-member', authorName: 'Old Name' },
      [member],
      [],
      FALLBACK
    )
    expect(a.name).toBe('Chao Li')
    expect(a.imageUrl).toBe('https://img.example/chao.png')
    expect(a.initials).toBe('CL')
  })

  it('resolves an optimistic comment without authorName through members', () => {
    const a = resolveCommentAuthor(
      { type: 'USER', authorActorId: 'actor-member' },
      [member],
      [],
      FALLBACK
    )
    expect(a.name).toBe('Chao Li')
  })

  it.each([
    ['null', { type: 'USER', authorActorId: 'actor-x', authorName: null }],
    ['missing', { type: 'USER', authorActorId: 'actor-x' }],
    ['empty', { type: 'USER', authorActorId: 'actor-x', authorName: '' }],
  ])('uses the localized fallback when authorName is %s', (_label, c) => {
    const a = resolveCommentAuthor(c, [member], [], FALLBACK)
    expect(a.name).toBe(FALLBACK)
  })

  it('keeps the AGENT branch unchanged', () => {
    const a = resolveCommentAuthor(
      { type: 'AGENT', authorActorId: 'agent-1', authorName: 'ignored' },
      [member],
      [{ actorId: 'agent-1', name: 'Claude Code' }],
      FALLBACK
    )
    expect(a).toMatchObject({
      isAgent: true,
      name: 'Claude Code',
      initials: 'CA',
    })
  })
})
