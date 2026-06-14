import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db/prisma'
import { mergeEvents, type RawEvent } from './merge-events'
import { Timeline } from './Timeline'
import { SummaryCard } from './SummaryCard'
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

  const session = await prisma.session.findFirst({
    where: { id, member: { clerkId: userId } },
    select: {
      id: true,
      cwd: true,
      startedAt: true,
      lastActivityAt: true,
      eventCount: true,
      summary: true,
      summaryType: true,
      summaryGeneratedAt: true,
      summaryEventCount: true,
    },
  })
  if (!session) notFound()

  const rawEvents = await prisma.hookEvent.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      toolName: true,
      payload: true,
      createdAt: true,
    },
  })

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
      <div className='mb-6'>
        <Link
          href='/sessions'
          className='text-sm text-muted-foreground hover:text-foreground'
        >
          ← Sessions
        </Link>
      </div>

      <header className='mb-8 space-y-2'>
        <h1 className='font-mono text-sm text-muted-foreground'>
          {session.id}
        </h1>
        <p className='text-lg'>{session.cwd ?? <em>no cwd</em>}</p>
        <dl className='grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5'>
          <div>
            <dt className='text-muted-foreground'>Started</dt>
            <dd>{fmtTime(session.startedAt)}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Last activity</dt>
            <dd>{fmtTime(session.lastActivityAt)}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Duration</dt>
            <dd>{durationMin} min</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Tool calls</dt>
            <dd>{toolCallCount}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Errors</dt>
            <dd className={errorCount > 0 ? 'text-red-600' : undefined}>
              {errorCount}
            </dd>
          </div>
        </dl>
      </header>

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

      <section>
        <h2 className='mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
          Timeline · click to expand
        </h2>
        <Timeline items={items} />
      </section>
    </div>
  )
}
