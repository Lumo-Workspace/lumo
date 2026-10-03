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
    findByWorkspaceAndClerkIds: jest.fn().mockResolvedValue([{ id: 'm1' }]),
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

  const expected = 'Q&A: x < y ok <!channel>'
  const channelPayload = (sendChannelNotification as jest.Mock).mock
    .calls[0][2] as { commentBody: string }
  expect(channelPayload.commentBody).toBe(expected)
  const deltaArgs = (notifyMentionDelta as jest.Mock).mock.calls[0][0] as {
    slackPayload: { commentBody: string }
  }
  expect(deltaArgs.slackPayload.commentBody).toBe(expected)
})
