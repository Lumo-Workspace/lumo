import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { formatTimestamp } from '@/lib/utils/formatTimestamp'

export const dynamic = 'force-dynamic'

export default async function SessionsPage() {
  const { userId } = await auth()
  if (!userId) redirect('/signin')

  const sessions = await sessionRepository.listForClerkUser(userId)

  return (
    <div className='mx-auto max-w-4xl px-6 py-10'>
      <header className='mb-6 flex items-baseline justify-between'>
        <h1 className='text-2xl font-semibold'>Sessions</h1>
        <span className='text-sm text-muted-foreground'>
          {sessions.length} recent
        </span>
      </header>

      {sessions.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          No sessions yet. Run <code>claude code</code> from a directory with
          Lumo hooks configured to see activity here.
        </p>
      ) : (
        <ul className='divide-y divide-border rounded-md border'>
          {sessions.map(s => (
            <li key={s.id}>
              <Link
                href={`/sessions/${s.id}`}
                className='flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40'
              >
                <div className='min-w-0 flex-1'>
                  <div className='truncate font-mono text-xs text-muted-foreground'>
                    {s.id}
                  </div>
                  <div className='truncate text-sm'>
                    {s.cwd ?? <span className='italic'>no cwd</span>}
                  </div>
                </div>
                <div className='shrink-0 text-right text-xs text-muted-foreground'>
                  <div>{formatTimestamp(s.lastActivityAt)}</div>
                  <div>{s.eventCount} events</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
