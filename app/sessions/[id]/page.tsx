import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { sessionDetailService } from '@/lib/services/session-detail.service'
import { countToolCalls, mergeEvents, type RawEvent } from './merge-events'
import { SessionHeader } from './SessionHeader'
import { SessionAttribution } from './SessionAttribution'
import { SummaryCard } from './SummaryCard'
import { TimelineSection } from './TimelineSection'
import { SessionRawRecordSection } from './SessionRawRecordSection'
import { SessionOwnerNotice } from './SessionOwnerNotice'
import { activeDurationMs } from '@/lib/agent-run/active-time'
import { ACTIVE_WORKSPACE_META } from '@/lib/workspace/active-workspace'

export const dynamic = 'force-dynamic'

function fmtTime(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19)
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/signin')

  const { id } = await params

  // LUM-946: the session's member or an OWNER of its workspace; anyone else
  // (and a missing id) gets the same 404 so ids can't be enumerated.
  const session = await sessionDetailService.getForViewer(id, userId)
  if (!session) notFound()

  const { workspaceSlug, rawEvents, attribution } = session

  const items = mergeEvents(rawEvents as RawEvent[])

  // Agent active time (Σ per-turn STOP − prompt), not the session wall-clock
  // span — a resumed session's idle gap would otherwise inflate it (LUM-487).
  const durationMs = activeDurationMs(rawEvents)
  const durationMin = Math.round(durationMs / 60000)

  const toolCallCount = countToolCalls(items)
  const errorCount = items.filter(i => i.status === 'error').length

  return (
    <div className='mx-auto max-w-5xl px-6 py-10'>
      {/* LUM-987: this page lives outside /workspace/<slug>, so it declares the
          session's workspace for apiFetch's active-workspace header. */}
      <meta name={ACTIVE_WORKSPACE_META} content={workspaceSlug} />
      <SessionHeader
        id={session.id}
        cwd={session.cwd}
        startedAt={fmtTime(session.startedAt)}
        lastActivityAt={fmtTime(session.lastActivityAt)}
        durationMin={durationMin}
        toolCallCount={toolCallCount}
        errorCount={errorCount}
      />

      {!session.isOwnSession && (
        <SessionOwnerNotice ownerName={session.ownerName} />
      )}

      <SummaryCard
        sessionId={session.id}
        initialSummary={session.summary}
        initialSummaryType={session.summaryType}
        initialGeneratedAt={session.summaryGeneratedAt?.toISOString() ?? null}
        initialEventCount={session.summaryEventCount}
        currentEventCount={session.eventCount}
        isStale={
          session.summaryGeneratedAt !== null &&
          session.lastActivityAt > session.summaryGeneratedAt
        }
      />

      <SessionAttribution view={attribution} />

      <SessionRawRecordSection sessionId={session.id} />

      <TimelineSection items={items} />
    </div>
  )
}
