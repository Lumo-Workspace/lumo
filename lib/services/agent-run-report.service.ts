import {
  agentRunTimelineService,
  type AgentRunSession,
  type AgentRunTimelineResult,
} from '@/lib/services/agent-run-timeline.service'
import { progressService } from '@/lib/services/progress.service'
import type { ModelCost } from '@/lib/services/model-cost'
import type { TaskProgress } from '@/lib/forecast/progress-types'
import {
  dedupeEvidence,
  groupSubagents,
  mergeGroupEvidence,
  summarizeRunAttributions,
  weakestConfidence,
  type AttributionConfidenceName,
  type AttributionSourceName,
  type DedupedEvidence,
  type RunAttributionMode,
} from '@/lib/attribution/run-attribution'
import {
  anyRunOverstated,
  runOverstated,
} from '@/lib/agent-run/usage-dedupe-cutoff'
import { countRunTurns, deriveRunDigest } from '@/lib/agent-run/run-digest'
import { memoryHeadline, truncateHeadline } from '@/lib/memory/render'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'
import { sanitizeField } from '@/lib/utils/sanitize'
import type { MemoryCategory, TaskArtifactAgent } from '@prisma/client'

/**
 * LUM-1188 — the headless read model of the task dossier's "Agent runs"
 * section: the same timeline + progress results the web renders, with the
 * same pure derivations the web components run in the browser (Sessions tile,
 * ≈ approximate, pre-dedupe marker, attribution badge, subagent groups,
 * digest), so `lumo task runs` prints numbers identical to the page.
 *
 * Deliberately left out: raw hook payloads / transcripts. Agent-produced text
 * (run summary, turn digest, memory headline, signal identifiers) is guarded
 * here with the full server-side single-line chain (secret redaction, fence
 * defang, directive marker) before it leaves the server.
 */

export interface AgentRunReportEvidence {
  kind: DedupedEvidence['kind']
  identifier: string
  at: string
  count: number
}

export interface AgentRunReportAttribution {
  mode: RunAttributionMode
  /** The web badge suffix for an auto-detected run; null otherwise. */
  weakestConfidence: AttributionConfidenceName | null
  approximate: boolean
  segments: Array<{
    source: AttributionSourceName
    confidence: AttributionConfidenceName
    /** 1-based, as the web panel prints them. */
    fromTurn: number
    toTurn: number
    evidence: AgentRunReportEvidence[]
  }>
  subagents: Array<{
    agentType: string | null
    count: number
    source: AttributionSourceName
    confidence: AttributionConfidenceName
    followsParent: boolean
    evidence: AgentRunReportEvidence[]
  }>
}

export interface AgentRunReportRun {
  runNumber: number
  sessionId: string | null
  agent: TaskArtifactAgent
  member: string | null
  startedAt: string
  durationMs: number
  turnCount: number
  toolCallCount: number
  eventCount: number
  memoryCount: number
  /** Guarded run summary; null when none was generated. */
  summary: string | null
  /** Guarded turn digest — shown only when there is no run summary. */
  digest: string[]
  cost: { byModel: ModelCost[]; total: number; loopCount: number | null } | null
  /** Token figures predate the usage-dedupe fix (≈2× overstated). */
  preDedupe: boolean
  attribution: AgentRunReportAttribution | null
  memories: Array<{ category: MemoryCategory; headline: string }>
}

export interface AgentRunReport {
  overview: {
    /** The Sessions tile; null when no run carries an attribution. */
    sessions: { explicit: number; inferred: number } | null
    approximate: boolean
    preDedupe: boolean
  }
  totals: AgentRunTimelineResult['totals'] & { total: number }
  perMember: Array<{
    name: string
    runCount: number
    loopCount: number
    byModel: ModelCost[]
    total: number
  }>
  progress: TaskProgress | null
  /** Newest first, as the web lists them. */
  runs: AgentRunReportRun[]
}

const MEMORY_HEADLINE_MAX = 160

/** Agent-produced free text → one guarded line. */
function guardLine(text: string): string {
  return guardPromptLineText(sanitizeField(text).replace(/\s*\n\s*/g, ' '))
}

function sumTotal(byModel: ModelCost[]): number {
  return byModel.reduce((n, m) => n + m.total, 0)
}

function toEvidence(e: DedupedEvidence): AgentRunReportEvidence {
  return {
    kind: e.kind,
    identifier: guardLine(e.identifier),
    at: e.at,
    count: e.count,
  }
}

function toAttribution(
  a: NonNullable<AgentRunSession['attribution']>
): AgentRunReportAttribution {
  return {
    mode: a.mode,
    weakestConfidence: a.mode === 'INFERRED' ? weakestConfidence(a) : null,
    approximate: a.approximate,
    segments: a.segments.map(s => ({
      source: s.source,
      confidence: s.confidence,
      fromTurn: s.fromTurn + 1,
      toTurn: s.toTurn + 1,
      evidence: dedupeEvidence(s.evidence).map(toEvidence),
    })),
    subagents: groupSubagents(a.subagents).map(g => ({
      agentType: g.sub.agentType ? guardLine(g.sub.agentType) : null,
      count: g.count,
      source: g.sub.source,
      confidence: g.sub.confidence,
      followsParent: g.sub.followsParent,
      evidence: mergeGroupEvidence(g.members).map(toEvidence),
    })),
  }
}

function toRun(run: AgentRunSession): AgentRunReportRun {
  const memories = run.items.flatMap(i =>
    i.kind === 'memory'
      ? [
          {
            category: i.category,
            headline: guardLine(
              truncateHeadline(
                memoryHeadline({
                  id: i.id,
                  scope: 'TASK',
                  category: i.category,
                  content: i.content,
                }),
                MEMORY_HEADLINE_MAX
              )
            ),
          },
        ]
      : []
  )
  return {
    runNumber: run.runNumber,
    sessionId: run.sessionId,
    agent: run.agent,
    member: run.member ? sanitizeField(run.member.name) : null,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    turnCount: countRunTurns(run.items),
    toolCallCount: run.toolCallCount,
    eventCount: run.eventCount,
    memoryCount: run.memoryCount,
    summary: run.runSummary ? guardLine(run.runSummary) : null,
    digest: run.runSummary ? [] : deriveRunDigest(run.items).map(guardLine),
    cost: run.cost
      ? {
          byModel: run.cost.byModel,
          total: sumTotal(run.cost.byModel),
          loopCount: run.cost.loopCount,
        }
      : null,
    preDedupe: runOverstated(run),
    attribution: run.attribution ? toAttribution(run.attribution) : null,
    memories,
  }
}

/** Pure: timeline + progress → the report. Exported for tests. */
export function buildAgentRunReport(
  timeline: AgentRunTimelineResult,
  progress: TaskProgress | null
): AgentRunReport {
  const attribution = summarizeRunAttributions(
    timeline.runs.map(r => r.attribution)
  )
  return {
    overview: {
      sessions:
        attribution.explicit + attribution.inferred > 0
          ? { explicit: attribution.explicit, inferred: attribution.inferred }
          : null,
      approximate: attribution.approximate,
      preDedupe: anyRunOverstated(timeline.runs),
    },
    totals: { ...timeline.totals, total: sumTotal(timeline.totals.byModel) },
    perMember: timeline.perMember.map(m => ({
      name: sanitizeField(m.name),
      runCount: m.runCount,
      loopCount: m.loopCount,
      byModel: m.byModel,
      total: sumTotal(m.byModel),
    })),
    progress,
    runs: timeline.runs.map(toRun),
  }
}

export const agentRunReportService = {
  async getReport(taskId: string): Promise<AgentRunReport> {
    const [timeline, progress] = await Promise.all([
      agentRunTimelineService.getTimeline(taskId),
      progressService.getProgress(taskId),
    ])
    return buildAgentRunReport(timeline, progress)
  },
}
