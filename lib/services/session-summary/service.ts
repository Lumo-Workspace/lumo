import { FAST_MODEL, CONTENT_MODEL } from '@/lib/ai/models'
import { APICallError } from 'ai'
import type { Prisma } from '@prisma/client'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'
import { AI_DERIVED_OFF_CODE } from '@/lib/ai-derived/constants'
import {
  compactEvents,
  extractSessionMetadata,
  type RawEvent,
} from './compact-events'
import { classifySession } from './classifier'
import { generateStructuredSummary, type TemplateKind } from './templates'
import type { SessionSummaryPayload, SessionType } from './types'

// Classifier routed through the gateway to deepseek-v4-flash (LUM-320) to cut
// cost. Content generation moved off Opus + the native Anthropic SDK to Sonnet
// 4.6 via the gateway (桶3/LUM-592).
const CLASSIFY_MODEL = FAST_MODEL

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
    const session = await sessionRepository.findByIdForMember(
      sessionId,
      workspaceMemberId
    )
    if (!session) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }
    // LUM-917: the workspace turned AI-derived content off.
    if (
      !(await aiDerivedContentService.isEnabled({
        workspaceId: session.workspaceId,
      }))
    ) {
      throw Object.assign(
        new Error('AI-derived content is turned off for this workspace'),
        { status: 409, code: AI_DERIVED_OFF_CODE }
      )
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
      summary = await generateStructuredSummary({
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
  if (APICallError.isInstance(err)) {
    const isRateLimit = err.statusCode === 429
    return Object.assign(
      new Error(
        isRateLimit
          ? `Gateway rate limit during ${stage} — try again shortly`
          : `Gateway error during ${stage}: ${err.message}`
      ),
      { status: isRateLimit ? 429 : 502 }
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}
