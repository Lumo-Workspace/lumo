import Anthropic from '@anthropic-ai/sdk'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { compactEvents, type RawEvent } from './compact-events'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'

const MODEL = 'claude-opus-4-7'
const MAX_TOKENS = 4096

export interface GenerateSummaryInput {
  sessionId: string
  workspaceMemberId: string
}

export interface GenerateSummaryResult {
  sessionId: string
  summary: string
  generatedAt: Date
}

/**
 * Generate a session summary via Claude, persist it on the Session row, and
 * return the new summary. Access control is the caller's responsibility in
 * the sense that we verify the session belongs to `workspaceMemberId` — the
 * route layer should still run any additional auth checks.
 */
export const sessionSummaryService = {
  async generateSummary({
    sessionId,
    workspaceMemberId,
  }: GenerateSummaryInput): Promise<GenerateSummaryResult> {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      throw Object.assign(new Error('ANTHROPIC_API_KEY not configured'), {
        status: 500,
      })
    }

    const session = await sessionRepository.findByIdForMember(
      sessionId,
      workspaceMemberId
    )
    if (!session) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }

    const events = await sessionRepository.listEventsForSession(sessionId)
    if (events.length === 0) {
      throw Object.assign(
        new Error('Session has no events yet — nothing to summarize'),
        { status: 400 }
      )
    }

    const compact = compactEvents(events as RawEvent[])
    const userPrompt = buildUserPrompt(
      {
        cwd: session.cwd,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        eventCount: session.eventCount,
      },
      compact.text,
      compact.truncatedCount
    )

    const client = new Anthropic({ apiKey: anthropicKey })

    let message
    try {
      message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      })
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        throw Object.assign(
          new Error('Claude API rate limit — try again shortly'),
          {
            status: 429,
          }
        )
      }
      if (err instanceof Anthropic.APIError) {
        throw Object.assign(new Error(`Claude API error: ${err.message}`), {
          status: 502,
        })
      }
      throw err
    }

    const textBlock = message.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    )
    const summaryText = textBlock?.text.trim() ?? ''

    if (!summaryText) {
      throw Object.assign(new Error('Claude returned an empty summary'), {
        status: 502,
      })
    }

    const generatedAt = new Date()
    await sessionRepository.updateSummary(sessionId, summaryText, generatedAt)

    return {
      sessionId,
      summary: summaryText,
      generatedAt,
    }
  },
}
