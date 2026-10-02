import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { sessionListService } from '@/lib/services/session-list.service'
import { mergeEvents, type RawEvent } from './merge-events'
import { SessionHeader } from './SessionHeader'
import { SessionAttribution } from './SessionAttribution'
import { SummaryCard } from './SummaryCard'
import { TimelineSection } from './TimelineSection'
import { activeDurationMs } from '@/lib/agent-run/active-time'

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

  // Ownership check first: getAttribution is not ownership-scoped.
  const session = await sessionRepository.findDetailForClerkUser(id, userId)
  if (!session) notFound()

  const rawEvents = await sessionRepository.listEventsForSession(id)

  // A subagent's detail page shows its family's attribution.
  const attribution = await sessionListService.getAttribution(
    session.parentSessionId ?? session.id
  )

  const items = mergeEvents(rawEvents as RawEvent[])

  // Agent active time (Σ per-turn STOP − prompt), not the session wall-clock
  // span — a resumed session's idle gap would otherwise inflate it (LUM-487).
  const durationMs = activeDurationMs(rawEvents)
  const durationMin = Math.round(durationMs / 60000)

  const toolCallCount = items.filter(
    i => i.kind === 'tool' || i.kind === 'orphan'
  ).length
  const errorCount = items.filter(i => i.status === 'error').length

  return (
    <div className='mx-auto max-w-5xl px-6 py-10'>
      <SessionHeader
        id={session.id}
        cwd={session.cwd}
        startedAt={fmtTime(session.startedAt)}
        lastActivityAt={fmtTime(session.lastActivityAt)}
        durationMin={durationMin}
        toolCallCount={toolCallCount}
        errorCount={errorCount}
      />

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

      <TimelineSection items={items} />
    </div>
  )
}
