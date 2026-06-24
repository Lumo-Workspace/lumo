import Anthropic from '@anthropic-ai/sdk'
import type { Prisma } from '@prisma/client'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  compactEvents,
  extractSessionMetadata,
  type RawEvent,
} from './compact-events'
import { classifySession } from './classifier'
import { generateStructuredSummary, type TemplateKind } from './templates'
import type { SessionSummaryPayload, SessionType } from './types'

// Classifier routed through the gateway to deepseek-v4-flash (LUM-320) to cut
// cost. Content generation stays on Opus — it's the quality-critical structured
// summary and was never part of the Haiku→DeepSeek cost migration.
const CLASSIFY_MODEL = 'deepseek/deepseek-v4-flash'
const CONTENT_MODEL = 'claude-opus-4-7'

// Classifier confidence below this threshold collapses to the mixed template,
// regardless of the picked type — we'd rather be honest about uncertainty
// than force a single-type template onto a genuinely multi-activity session.
const CONFIDENCE_THRESHOLD = 0.6

export interface GenerateSummaryInput {
  sessionId: string
  workspaceMemberId: string
}

export interface GenerateSummaryResult {
  sessionId: string
  summaryType: SessionType
  summary: SessionSummaryPayload
  generatedAt: Date
  eventCount: number
  classifyModel: string
  contentModel: string
}

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

    const events = (await sessionRepository.listEventsForSession(
      sessionId
    )) as RawEvent[]
    if (events.length === 0) {
      throw Object.assign(
        new Error('Session has no events yet — nothing to summarize'),
        { status: 400 }
      )
    }

    const client = new Anthropic({ apiKey: anthropicKey })
    const metadata = extractSessionMetadata(events)

    let classification
    try {
      classification = await classifySession({
        metadata,
        sessionStartedAt: session.startedAt,
      })
    } catch (err) {
      throw toApiError(err, 'classifier')
    }

    const kind: TemplateKind =
      classification.confidence >= CONFIDENCE_THRESHOLD
        ? classification.type
        : 'mixed'

    const compact = compactEvents(events)

    let summary: SessionSummaryPayload
    try {
      summary = await generateStructuredSummary(client, {
        kind,
        compactLog: compact.text,
        truncatedToolCount: compact.truncatedCount,
        sessionMeta: {
          cwd: session.cwd,
          durationMs: metadata.durationMs,
          toolCallCount: metadata.toolCallCount,
        },
      })
    } catch (err) {
      throw toApiError(err, 'content generator')
    }

    const generatedAt = new Date()
    await sessionRepository.updateSummary({
      id: sessionId,
      summary: summary as unknown as Prisma.InputJsonValue,
      summaryType: summary.type,
      generatedAt,
      classifyModel: CLASSIFY_MODEL,
      contentModel: CONTENT_MODEL,
      eventCount: events.length,
    })

    return {
      sessionId,
      summaryType: summary.type,
      summary,
      generatedAt,
      eventCount: events.length,
      classifyModel: CLASSIFY_MODEL,
      contentModel: CONTENT_MODEL,
    }
  },
}

function toApiError(err: unknown, stage: string): Error {
  if (err instanceof Anthropic.RateLimitError) {
    return Object.assign(
      new Error(`Claude API rate limit during ${stage} — try again shortly`),
      { status: 429 }
    )
  }
  if (err instanceof Anthropic.APIError) {
    return Object.assign(
      new Error(`Claude API error during ${stage}: ${err.message}`),
      { status: 502 }
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}
