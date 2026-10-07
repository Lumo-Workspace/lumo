import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { slackRepository } from '@/lib/repositories/slack.repository'
import { decrypt } from '@/lib/crypto'
import { handleCommand, CommandResult } from '@/lib/integrations/slack'
import { createHmac, timingSafeEqual } from 'crypto'

function verifySlackSignature(
  body: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false

  const sigBasestring = `v0:${timestamp}:${body}`
  const expected =
    'v0=' +
    createHmac('sha256', secret).update(sigBasestring, 'utf8').digest('hex')

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
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

    // 3. Parse JSON
    const payload = JSON.parse(rawBody)

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

    if (
      payload.type === 'event_callback' &&
      payload.event?.type === 'app_mention'
    ) {
      // @Lumo mention — strip the "<@BOTID> " prefix
      const raw: string = payload.event.text ?? ''
      commandText = raw.replace(/^<@[^>]+>\s*/, '').trim()
      channelId = payload.event.channel
      slackUserId = payload.event.user
    } else if (payload.command) {
      // /lumo slash command
      commandText = payload.text ?? ''
      responseUrl = payload.response_url ?? ''
      channelId = payload.channel_id
      slackUserId = payload.user_id
    } else {
      // Unhandled event type — acknowledge silently
      return new NextResponse(null, { status: 200 })
    }

    // 7. Execute command asynchronously — must return 200 within 3 s for slash commands
    const executeCommand = async () => {
      const result: CommandResult = await handleCommand(
        commandText,
        slackUserId,
        token,
        integration.workspaceId
      )

      const messageBody =
        result.type === 'blocks'
          ? { blocks: result.blocks }
          : { text: result.text }

      if (responseUrl) {
        // Slash command response — post back to the response_url provided by Slack
        await fetch(responseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...messageBody,
            response_type: 'in_channel',
          }),
        })
      } else {
        // Mention — reply in the same channel
        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: channelId, ...messageBody }),
        })
      }
    }

    // Fire-and-forget — must return 200 before the 3 s Slack timeout
    executeCommand().catch(err =>
      console.error('[slack webhook] command error:', err)
    )

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    console.error('POST /api/webhooks/slack error:', error)
    // Always return 200 so Slack does not retry
    return new NextResponse(null, { status: 200 })
  }
}
