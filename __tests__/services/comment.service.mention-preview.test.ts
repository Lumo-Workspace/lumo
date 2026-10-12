// LUM-928: the Slack comment preview is built from the stored comment HTML.
// It must decode the editor's HTML entities before the Slack layer escapes
// them, otherwise `&` in a comment reaches Slack as `&amp;amp;`.
/** @jest-environment node */
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { scheduleOutbound: jest.fn() },
}))
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories', () => ({
  memberRepository: {
    findByWorkspaceAndClerkIds: jest
      .fn()
      .mockResolvedValue([{ id: 'm1', clerkId: 'u2' }]),
  },
  notificationRepository: { createMany: jest.fn() },
  taskRepository: { updateCommentsSummary: jest.fn() },
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendDMNotification: jest.fn(),
  sendChannelNotification: jest.fn(),
}))
jest.mock('@/lib/integrations/pusher', () => ({
  pushTaskEvent: jest.fn(),
  pushUserEvent: jest.fn(),
}))
jest.mock('@/lib/events/dispatcher', () => ({ dispatchEvents: jest.fn() }))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: jest.fn(),
}))

import { commentService } from '@/lib/services/comment.service'
import { sendChannelNotification } from '@/lib/integrations/slack'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'

it('comment mention preview decodes stored HTML entities before Slack', async () => {
  jest.spyOn(commentService, 'parseMentionedClerkIds').mockReturnValue(['u2'])

  await commentService.notifyMentions({
    taskId: 't1',
    commentId: 'c1',
    body: '<p>Q&amp;A: x &lt; y&nbsp;ok &lt;!channel&gt;</p>',
    authorActorId: 'a1',
    authorClerkId: 'u1',
    workspaceId: 'w1',
    projectId: 'p1',
    taskTitle: 't',
    taskNumber: 1,
    teamIdentifier: 'X',
    workspaceSlug: 's',
    projectName: 'p',
    waitUntil: (p: Promise<unknown>) => p,
  })

  // Decoded once to plain text; the Slack layer escapes it (LUM-928).
  const channelPayload = (sendChannelNotification as jest.Mock).mock
    .calls[0][2] as Record<string, unknown>
  expect(channelPayload.quote).toBe('Q&A: x < y ok <!channel>')
  // LUM-1095: the channel post is about the task, names the author and the
  // mentioned people by id (resolved to names by the sender, never pinged).
  expect(channelPayload).toMatchObject({
    entityKind: 'task',
    entityId: 't1',
    entityTitle: 't',
    entityIdentifier: 'X-1',
    entityUrl: expect.stringContaining('/tasks/X-1'),
    mentionSurface: 'comment',
    actorClerkId: 'u1',
    mentionedClerkIds: ['u2'],
  })
  // DMs quote the comment per recipient inside notifyMentionDelta.
  const deltaArgs = (notifyMentionDelta as jest.Mock).mock.calls[0][0] as {
    slackPayload: Record<string, unknown>
  }
  expect(deltaArgs.slackPayload).toMatchObject({
    entityKind: 'task',
    entityIdentifier: 'X-1',
    mentionSurface: 'comment',
  })
})

it('keeps comment paragraphs in the channel quote', async () => {
  jest.spyOn(commentService, 'parseMentionedClerkIds').mockReturnValue(['u2'])
  ;(sendChannelNotification as jest.Mock).mockClear()
  await commentService.notifyMentions({
    taskId: 't1',
    commentId: 'c2',
    body: '<p>First</p><p>Second</p>',
    authorActorId: 'a1',
    authorClerkId: 'u1',
    workspaceId: 'w1',
    projectId: 'p1',
    taskTitle: 't',
    taskNumber: 1,
    teamIdentifier: 'X',
    workspaceSlug: 's',
    projectName: 'p',
    waitUntil: (p: Promise<unknown>) => p,
  })
  const payload = (sendChannelNotification as jest.Mock).mock.calls[0][2] as {
    quote: string
  }
  expect(payload.quote).toBe('First\nSecond')
})
