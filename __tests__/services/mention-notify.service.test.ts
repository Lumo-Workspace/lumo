import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// next/jest uses SWC, whose jest transform only allows factory closures to
// reference variables prefixed with `mock` (it hoists jest.mock above these
// declarations). Hence the `mock`-prefixed names below.
const mockFindByWorkspaceAndClerkIds =
  jest.fn<(...args: any[]) => Promise<unknown>>()
const mockCreateMany = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockShouldNotifyBatch = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockSendDMNotification = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockPushUserEvent = jest.fn<(...args: any[]) => Promise<unknown>>()

jest.mock('@/lib/repositories', () => ({
  memberRepository: {
    findByWorkspaceAndClerkIds: (...a: unknown[]) =>
      mockFindByWorkspaceAndClerkIds(...a),
  },
  notificationRepository: {
    createMany: (...a: unknown[]) => mockCreateMany(...a),
  },
}))
jest.mock('@/lib/services/notification.service', () => ({
  shouldNotifyBatch: (...a: unknown[]) => mockShouldNotifyBatch(...a),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendDMNotification: (...a: unknown[]) => mockSendDMNotification(...a),
}))
jest.mock('@/lib/integrations/pusher', () => ({
  pushUserEvent: (...a: unknown[]) => mockPushUserEvent(...a),
}))

// Import lazily (after jest.mock registration) so the service's barrel import
// resolves to the mocked module, not the real one.
async function notifyMentionDelta(
  ...args: Parameters<
    (typeof import('@/lib/services/mention-notify.service'))['notifyMentionDelta']
  >
): Promise<void> {
  const mod = await import('@/lib/services/mention-notify.service')
  return mod.notifyMentionDelta(...args)
}

const M = (clerkId: string, actorId: string) => ({
  clerkId,
  actor: { id: actorId },
})
const span = (clerkId: string) =>
  `<span class="mention" data-mention-type="user" data-id="${clerkId}">@x</span>`

beforeEach(() => {
  jest.clearAllMocks()
  mockFindByWorkspaceAndClerkIds.mockResolvedValue([M('u1', 'a1')])
  mockShouldNotifyBatch.mockResolvedValue(new Set(['a1']))
  mockCreateMany.mockResolvedValue({ count: 1 })
  mockSendDMNotification.mockResolvedValue(undefined)
  mockPushUserEvent.mockResolvedValue(undefined)
})

const base = {
  authorClerkId: 'author',
  authorActorId: 'authorActor',
  workspaceId: 'ws1',
  notificationType: 'PROJECT_MENTIONED' as const,
  ref: { projectId: 'p1' },
  slackEvent: 'comment_mention' as const,
  slackPayload: {
    entityKind: 'project' as const,
    entityTitle: 'Proj',
    entityUrl: 'http://x',
    mentionSurface: 'content' as const,
  },
  waitUntil: (p: Promise<unknown>) => {
    void p
  },
}

describe('notifyMentionDelta', () => {
  it('notifies only newly-added mentions (delta = new − old)', async () => {
    await notifyMentionDelta({ ...base, oldHtml: '', newHtml: span('u1') })
    expect(mockFindByWorkspaceAndClerkIds).toHaveBeenCalledWith('ws1', ['u1'])
    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    const rows = mockCreateMany.mock.calls[0]![0] as Array<
      Record<string, unknown>
    >
    expect(rows[0]).toMatchObject({
      type: 'PROJECT_MENTIONED',
      projectId: 'p1',
      recipientActorId: 'a1',
    })
  })

  it('does NOT notify when the mention already existed in old content', async () => {
    await notifyMentionDelta({
      ...base,
      oldHtml: span('u1'),
      newHtml: span('u1'),
    })
    expect(mockFindByWorkspaceAndClerkIds).not.toHaveBeenCalled()
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('treats null/empty old content as all-new', async () => {
    await notifyMentionDelta({ ...base, oldHtml: null, newHtml: span('u1') })
    expect(mockCreateMany).toHaveBeenCalledTimes(1)
  })

  it('excludes the author from the delta', async () => {
    await notifyMentionDelta({ ...base, oldHtml: '', newHtml: span('author') })
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('skips inbox row for a recipient who disabled inApp mention but still DMs if slack-enabled', async () => {
    mockFindByWorkspaceAndClerkIds.mockResolvedValue([
      M('u1', 'a1'),
      M('u2', 'a2'),
    ])
    mockShouldNotifyBatch.mockImplementation((_a: unknown, ch: string) =>
      Promise.resolve(ch === 'inApp' ? new Set(['a1']) : new Set(['a1', 'a2']))
    )
    await notifyMentionDelta({
      ...base,
      oldHtml: '',
      newHtml: span('u1') + span('u2'),
    })
    expect(mockSendDMNotification).toHaveBeenCalledTimes(2)
    const rows = mockCreateMany.mock.calls[0]![0] as Array<
      Record<string, unknown>
    >
    expect(rows.map(r => r.recipientActorId)).toEqual(['a1'])
  })

  it("DMs quote the paragraph around each recipient's own mention (content)", async () => {
    mockFindByWorkspaceAndClerkIds.mockResolvedValue([
      M('u1', 'a1'),
      M('u2', 'a2'),
    ])
    mockShouldNotifyBatch.mockResolvedValue(new Set(['a1', 'a2']))
    await notifyMentionDelta({
      ...base,
      oldHtml: '',
      newHtml: `<p>Intro text.</p><p>${span('u1')} owns API</p><p>${span('u2')} owns UI</p>`,
    })
    const byRecipient = Object.fromEntries(
      mockSendDMNotification.mock.calls.map(c => [c[1], c[3]])
    ) as Record<string, Record<string, unknown>>
    expect(byRecipient.u1).toMatchObject({
      entityKind: 'project',
      entityTitle: 'Proj',
      actorClerkId: 'author',
      quote: '@x owns API',
    })
    expect(byRecipient.u2!.quote).toBe('@x owns UI')
  })

  it('DMs quote a comment whole, keeping its paragraphs', async () => {
    await notifyMentionDelta({
      ...base,
      slackPayload: { ...base.slackPayload, mentionSurface: 'comment' },
      oldHtml: '',
      newHtml: `<p>Hi ${span('u1')}</p><p>second para</p>`,
    })
    expect(mockSendDMNotification.mock.calls[0]![3]).toMatchObject({
      quote: 'Hi @x\nsecond para',
    })
  })
})
