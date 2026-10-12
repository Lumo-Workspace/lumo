import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { slackRepository } from '@/lib/repositories/slack.repository'
import { decrypt } from '@/lib/crypto'
import { handleCommand, CommandResult } from '@/lib/integrations/slack'
import {
  sendMentionReply,
  sendSlashCommandReply,
} from '@/lib/integrations/slack/reply'
import {
  isSlackResponseUrl,
  parseSlackRequestBody,
  verifySlackSignature,
} from '@/lib/integrations/slack/request'
import { waitUntil } from '@/lib/runtime/wait-until'
import { logger } from '@/lib/logger'

// Fields read from the parsed Slack body: Events API JSON or slash-command form.
interface SlackPayload {
  type?: string
  challenge?: string
  team_id?: string
  team?: { id?: string }
  event?: {
    type?: string
    text?: string
    channel?: string
    user?: string
    ts?: string
    thread_ts?: string
  }
  command?: string
  text?: string
  response_url?: string
  channel_id?: string
  user_id?: string
}

export async function POST(request: NextRequest) {
  // LUM-1025: not configured on this deployment → 404, never a 500.
  const notConfigured = requireIntegrationConfigured('slack')
  if (notConfigured) return notConfigured
  try {
    // 1. Read raw body before any parsing
    const rawBody = await request.text()
    const timestamp = request.headers.get('x-slack-request-timestamp') ?? ''
    const signature = request.headers.get('x-slack-signature') ?? ''

    // 2. Verify HMAC signature
    if (
      !verifySlackSignature(
        rawBody,
        signature,
        timestamp,
        process.env.SLACK_SIGNING_SECRET!
      )
    ) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // 3. Parse by Content-Type — only after the signature check above
    //    (LUM-1080: slash commands are form-encoded, events are JSON).
    const payload = parseSlackRequestBody(
      rawBody,
      request.headers.get('content-type')
    ) as SlackPayload | null
    if (!payload) {
      // Acknowledge (200) like every other unhandled request, so Slack does
      // not retry a body that will never parse.
      logger.warn('[slack webhook] unparseable body', {
        contentType: request.headers.get('content-type'),
      })
      return new NextResponse(null, { status: 200 })
    }

    // 4. Handle Slack URL verification challenge (one-time setup handshake)
    if (payload.type === 'url_verification') {
      return NextResponse.json({ challenge: payload.challenge })
    }

    // 5. Identify workspace by Slack team_id
    const teamId: string = payload.team_id ?? payload.team?.id ?? ''
    if (!teamId) return new NextResponse(null, { status: 200 })

    const integration = await slackRepository.findIntegrationByTeamId(teamId)
    if (!integration) return new NextResponse(null, { status: 200 })

    const token = decrypt(integration.accessToken)

    // 6. Route to the correct handler branch
    let commandText = ''
    let responseUrl = ''
    let channelId = ''
    let slackUserId = ''
    let threadTs: string | undefined

    if (
      payload.type === 'event_callback' &&
      payload.event?.type === 'app_mention'
    ) {
      // @Lumo mention — strip the "<@BOTID> " prefix
      const raw: string = payload.event.text ?? ''
      commandText = raw.replace(/^<@[^>]+>\s*/, '').trim()
      channelId = payload.event.channel ?? ''
      slackUserId = payload.event.user ?? ''
      // LUM-1096: answer in the mention's thread (or start one under it).
      threadTs = payload.event.thread_ts ?? payload.event.ts
    } else if (payload.command) {
      // /lumo slash command — reply only to a Slack-hosted response_url
      if (!isSlackResponseUrl(payload.response_url)) {
        return new NextResponse(null, { status: 200 })
      }
      commandText = payload.text ?? ''
      responseUrl = payload.response_url ?? ''
      channelId = payload.channel_id ?? ''
      slackUserId = payload.user_id ?? ''
    } else {
      // Unhandled event type — acknowledge silently
      return new NextResponse(null, { status: 200 })
    }

    // 7. Execute command asynchronously — must return 200 within 3 s for slash commands
    // Never rejects: an error here is logged, and the webhook has already
    // answered 200, so Slack does not retry (and re-run) the command.
    const executeCommand = async () => {
      try {
        const result: CommandResult = await handleCommand(
          commandText,
          slackUserId,
          token,
          integration.workspaceId
        )

        // LUM-1094 text fallback + LUM-1096 visibility/thread live in reply.ts.
        if (responseUrl) {
          await sendSlashCommandReply(responseUrl, result)
        } else {
          await sendMentionReply(token, result, {
            channel: channelId,
            user: slackUserId,
            threadTs,
          })
        }
      } catch (error) {
        logger.error('[slack webhook] command failed', error)
      }
    }

    // Return 200 before the 3 s Slack timeout; waitUntil keeps the function
    // alive until the reply is posted (a bare floating promise can be frozen
    // once the response is sent on serverless).
    waitUntil(executeCommand())

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    logger.error('POST /api/webhooks/slack error:', error)
    // Always return 200 so Slack does not retry
    return new NextResponse(null, { status: 200 })
  }
}
