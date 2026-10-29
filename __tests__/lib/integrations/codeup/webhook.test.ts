/**
 * @jest-environment node
 *
 * LUM-1315 — Codeup webhook payload parsing and token checks, against
 * fixtures recorded from the sample payloads in Alibaba Cloud's Codeup
 * webhook guide (branch names adapted to a Lumo task branch).
 */
import mergeRequestHook from '../../../fixtures/codeup/merge-request-hook.json'
import pushHook from '../../../fixtures/codeup/push-hook.json'
import {
  deliveryRepositoryId,
  hashWebhookToken,
  mergeRequestState,
  parseMergeRequestEvent,
  parsePushEvent,
  webhookTokenMatches,
} from '@/lib/integrations/codeup/webhook'

describe('webhook tokens', () => {
  it('hashes to a 64-char hex digest', () => {
    expect(hashWebhookToken('abc')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches only the token behind the stored hash', () => {
    const stored = hashWebhookToken('right-token')
    expect(webhookTokenMatches('right-token', stored)).toBe(true)
    expect(webhookTokenMatches('wrong-token', stored)).toBe(false)
    expect(webhookTokenMatches('right-token', '')).toBe(false)
    expect(webhookTokenMatches('right-token', 'abcd')).toBe(false)
  })
})

describe('deliveryRepositoryId', () => {
  it('reads project_id on a push and target_project_id on a merge request', () => {
    expect(deliveryRepositoryId(pushHook)).toBe(14)
    expect(deliveryRepositoryId(mergeRequestHook)).toBe(14)
    expect(deliveryRepositoryId({})).toBeNull()
    expect(deliveryRepositoryId(null)).toBeNull()
  })
})

describe('mergeRequestState', () => {
  it('collapses Codeup states to open / closed / merged', () => {
    expect(mergeRequestState('opened')).toBe('open')
    expect(mergeRequestState('reopened')).toBe('open')
    expect(mergeRequestState('merged')).toBe('merged')
    expect(mergeRequestState('closed')).toBe('closed')
    expect(mergeRequestState('locked')).toBe('closed')
  })
})

describe('parseMergeRequestEvent', () => {
  it('reads the documented Merge Request Hook sample', () => {
    expect(parseMergeRequestEvent(mergeRequestHook)).toEqual({
      iid: 1,
      action: 'open',
      title: 'MS-Viewport',
      url: 'https://codeup.aliyun.com/demo/demo/merge_requests/1',
      state: 'open',
      sourceBranch: 'lumo/LUM-12-add-login',
      targetBranch: 'master',
      headSha: 'da1560886d4f094c3e6c9ef40349f7d38b5d27d7',
      authorLogin: 'codeup',
      isDraft: false,
      updatedAt: new Date('2013-12-03T17:23:34Z'),
    })
  })

  it('returns null when required fields are missing', () => {
    expect(parseMergeRequestEvent({ object_attributes: {} })).toBeNull()
    expect(parseMergeRequestEvent(pushHook)).toBeNull()
  })
})

describe('parsePushEvent', () => {
  it('reads the branch and head commit of the documented Push Hook sample', () => {
    expect(parsePushEvent(pushHook)).toEqual({
      branchName: 'lumo/LUM-12-add-login',
      headSha: 'eb63d0277e64684236ebf8394b919230c4b8a286',
      commitMessage: 'fixed readme',
      commitAuthor: 'Lumo Dev',
    })
  })

  it('ignores tag pushes and branch deletions', () => {
    expect(parsePushEvent({ ...pushHook, ref: 'refs/tags/v1' })).toBeNull()
    expect(
      parsePushEvent({
        ...pushHook,
        after: '0000000000000000000000000000000000000000',
      })
    ).toBeNull()
  })

  it('falls back to the pusher when the head commit is not listed', () => {
    expect(parsePushEvent({ ...pushHook, commits: [] })).toMatchObject({
      commitMessage: null,
      commitAuthor: 'Codeup',
    })
  })
})
