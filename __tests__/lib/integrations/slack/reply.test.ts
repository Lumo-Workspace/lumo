/**
 * @jest-environment node
 *
 * LUM-1096 — how a command reply is posted back to Slack.
 */
import { logger } from '@/lib/logger'
import {
  sendSlashCommandReply,
  commandMessage,
  mentionReplyRequest,
  slashCommandReplyBody,
} from '@/lib/integrations/slack/reply'

const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }]

describe('slashCommandReplyBody', () => {
  it('maps visibility to response_type and keeps the text fallback', () => {
    expect(
      slashCommandReplyBody({
        type: 'blocks',
        text: 'ENG-1 · Fix',
        blocks,
        visibility: 'ephemeral',
      })
    ).toEqual({ text: 'ENG-1 · Fix', blocks, response_type: 'ephemeral' })
    expect(
      slashCommandReplyBody({
        type: 'text',
        text: 'ok',
        visibility: 'in_channel',
      }).response_type
    ).toBe('in_channel')
  })

  it('never sends an empty text', () => {
    expect(
      commandMessage({ type: 'text', text: ' ', visibility: 'ephemeral' }).text
    ).not.toBe('')
  })
})

describe('mentionReplyRequest', () => {
  const ctx = { channel: 'C1', user: 'U1', threadTs: '1.2' }

  it('in_channel → chat.postMessage in the thread', () => {
    expect(
      mentionReplyRequest(
        { type: 'blocks', text: 't', blocks, visibility: 'in_channel' },
        ctx
      )
    ).toEqual({
      url: 'https://slack.com/api/chat.postMessage',
      body: { channel: 'C1', thread_ts: '1.2', text: 't', blocks },
    })
  })

  it('ephemeral → chat.postEphemeral to the mentioning user, in the thread', () => {
    expect(
      mentionReplyRequest(
        { type: 'text', text: 'e', visibility: 'ephemeral' },
        ctx
      )
    ).toEqual({
      url: 'https://slack.com/api/chat.postEphemeral',
      body: { channel: 'C1', user: 'U1', thread_ts: '1.2', text: 'e' },
    })
  })

  it('ephemeral without a known user falls back to a thread reply', () => {
    expect(
      mentionReplyRequest(
        { type: 'text', text: 'e', visibility: 'ephemeral' },
        { channel: 'C1', user: '', threadTs: '1.2' }
      ).url
    ).toBe('https://slack.com/api/chat.postMessage')
  })

  it('omits thread_ts when there is no thread', () => {
    const { body } = mentionReplyRequest(
      { type: 'text', text: 'ok', visibility: 'in_channel' },
      { channel: 'C1', user: 'U1' }
    )
    expect(body).toEqual({ channel: 'C1', text: 'ok' })
  })
})

describe('sendSlashCommandReply', () => {
  it('logs (does not throw) when the response_url rejects the reply', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    global.fetch = jest.fn(
      async () => new Response('expired_url', { status: 404 })
    ) as unknown as typeof fetch
    await sendSlashCommandReply('https://hooks.slack.com/commands/x', {
      type: 'text',
      text: 'ok',
      visibility: 'ephemeral',
    })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('response_url rejected'),
      { status: 404 }
    )
    warn.mockRestore()
  })
})
