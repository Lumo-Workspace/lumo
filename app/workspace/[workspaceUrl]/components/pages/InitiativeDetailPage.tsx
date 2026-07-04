'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Lightbulb, ListChecks, Target } from 'lucide-react'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { Badge } from '@/components/ui/badge'
import type {
  ApiInitiativeStatus,
  ApiTaskStatus,
} from '@/lib/api-client/initiatives'
import { useInitiativeDetail } from '../../hooks/useInitiatives'

const INITIATIVE_STATUS_KEY: Record<ApiInitiativeStatus, string> = {
  ACTIVE: 'initiative.status.active',
  DONE: 'initiative.status.done',
  DROPPED: 'initiative.status.dropped',
}

// Convey status by Badge variant (semantic, token-backed) rather than brand
// colors — the live one stands out (primary), completed recedes (secondary),
// dropped is de-emphasized (outline).
const INITIATIVE_STATUS_VARIANT: Record<
  ApiInitiativeStatus,
  'default' | 'secondary' | 'outline'
> = {
  ACTIVE: 'default',
  DONE: 'secondary',
  DROPPED: 'outline',
}

const TASK_STATUS_KEY: Record<ApiTaskStatus, string> = {
  TODO: 'initiative.task.todo',
  IN_PROGRESS: 'initiative.task.inProgress',
  IN_REVIEW: 'initiative.task.inReview',
  DONE: 'initiative.task.done',
}

/**
 * Initiative detail page (LUM-673). Renders a materialised initiative's goal,
 * its bet (assumption note), status, and its lineage — the consumed ideas and
 * the attached tasks with a progress read-out. The id is read from the route
 * (`/workspace/<slug>/initiatives/<initiativeId>`).
 */
export function InitiativeDetailPage() {
  const intl = useIntl()
  const { workspaceUrl, initiativeId } = useParams<{
    workspaceUrl: string
    initiativeId: string
  }>()
  const { initiative, isLoading, error } = useInitiativeDetail(
    initiativeId ?? null
  )

  const backHref = `/workspace/${workspaceUrl}/initiatives`

  if (isLoading) {
    return (
      <div className='flex h-full flex-col overflow-hidden'>
        <PageBreadcrumb
          title={intl.formatMessage({ id: 'sidebar.initiatives' })}
        />
        <div className='flex-1 p-8 text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'initiative.detail.loading' })}
        </div>
      </div>
    )
  }

  if (error || !initiative) {
    return (
      <div className='flex h-full flex-col overflow-hidden'>
        <PageBreadcrumb
          title={intl.formatMessage({ id: 'sidebar.initiatives' })}
        />
        <div className='flex-1 p-8 text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'initiative.detail.notFound' })}
        </div>
      </div>
    )
  }

  const { taskProgress } = initiative

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <PageBreadcrumb title={initiative.identifier} />
      <div className='flex-1 overflow-y-auto px-4 py-6 md:px-8'>
        <div className='mx-auto flex max-w-3xl flex-col gap-8'>
          {/* Header — id, status, goal */}
          <header className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
              <span className='font-mono text-sm text-muted-foreground'>
                {initiative.identifier}
              </span>
              <Badge variant={INITIATIVE_STATUS_VARIANT[initiative.status]}>
                {intl.formatMessage({
                  id: INITIATIVE_STATUS_KEY[initiative.status],
                })}
              </Badge>
            </div>
            <h1 className='flex items-start gap-2 text-2xl font-semibold leading-tight'>
              <Target className='mt-1 size-5 shrink-0 text-muted-foreground' />
              {initiative.goalStatement}
            </h1>
          </header>

          {/* Bet — the assumption note behind the initiative */}
          {initiative.assumptionNote ? (
            <section className='rounded-lg border border-dashed p-4'>
              <h2 className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                {intl.formatMessage({ id: 'initiative.detail.bet' })}
              </h2>
              <p className='text-sm text-foreground/90'>
                {initiative.assumptionNote}
              </p>
            </section>
          ) : null}

          {/* Attached tasks — lineage forward, with progress */}
          <section>
            <h2 className='mb-3 flex items-center gap-2 text-sm font-semibold'>
              <ListChecks className='size-4 text-muted-foreground' />
              {intl.formatMessage({ id: 'initiative.detail.attachedTasks' })}
              <span className='font-normal text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'initiative.detail.progress' },
                  { done: taskProgress.done, total: taskProgress.total }
                )}
              </span>
            </h2>
            {initiative.tasks.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {intl.formatMessage({ id: 'initiative.detail.noTasks' })}
              </p>
            ) : (
              <ul className='flex flex-col gap-1'>
                {initiative.tasks.map(task => (
                  <li
                    key={task.id}
                    className='flex items-center gap-3 rounded-md border px-3 py-2 text-sm'
                  >
                    <span className='font-mono text-xs text-muted-foreground'>
                      {task.identifier}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>
                      {task.title}
                    </span>
                    <Badge variant='outline' className='shrink-0 text-xs'>
                      {intl.formatMessage({
                        id: TASK_STATUS_KEY[task.status],
                      })}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Consumed ideas — lineage backward */}
          <section>
            <h2 className='mb-3 flex items-center gap-2 text-sm font-semibold'>
              <Lightbulb className='size-4 text-muted-foreground' />
              {intl.formatMessage({ id: 'initiative.detail.consumedIdeas' })}
            </h2>
            {initiative.ideas.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {intl.formatMessage({ id: 'initiative.detail.noIdeas' })}
              </p>
            ) : (
              <ul className='flex flex-col gap-1'>
                {initiative.ideas.map(idea => (
                  <li
                    key={idea.id}
                    className='flex items-start gap-3 rounded-md border px-3 py-2 text-sm'
                  >
                    <span className='font-mono text-xs text-muted-foreground'>
                      {idea.identifier}
                    </span>
                    <span className='min-w-0 flex-1'>{idea.statement}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Link
            href={backHref}
            className='text-sm text-muted-foreground hover:text-foreground hover:underline'
          >
            {intl.formatMessage({ id: 'initiative.detail.backToList' })}
          </Link>
        </div>
      </div>
    </div>
  )
}
