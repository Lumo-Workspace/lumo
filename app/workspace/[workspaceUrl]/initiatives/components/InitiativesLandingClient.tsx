'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Lightbulb, ListChecks, Target } from 'lucide-react'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
import { Badge } from '@/components/ui/badge'
import type { ApiInitiativeStatus } from '@/lib/api-client/initiatives'
import { useInitiatives } from '../../hooks/useInitiatives'

const STATUS_KEY: Record<ApiInitiativeStatus, string> = {
  ACTIVE: 'initiative.status.active',
  DONE: 'initiative.status.done',
  DROPPED: 'initiative.status.dropped',
}

// Semantic Badge variants (token-backed) instead of brand colors — active
// stands out (primary), done recedes (secondary), dropped de-emphasized.
const STATUS_VARIANT: Record<
  ApiInitiativeStatus,
  'default' | 'secondary' | 'outline'
> = {
  ACTIVE: 'default',
  DONE: 'secondary',
  DROPPED: 'outline',
}

/**
 * Initiatives landing (LUM-673) — the caller team's materialised initiatives.
 * Each card links to the detail page where the lineage (which ideas became it,
 * which tasks hang off it) is shown. First-class browse; does not touch the
 * core Milestone concept.
 */
export function InitiativesLandingClient() {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const { initiatives, isLoading, error } = useInitiatives()

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <PageBreadcrumb
        title={intl.formatMessage({ id: 'sidebar.initiatives' })}
      />
      <div className='flex-1 overflow-y-auto px-4 py-6 md:px-8'>
        <div className='mx-auto max-w-3xl'>
          {isLoading ? (
            <p className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'initiative.list.loading' })}
            </p>
          ) : error ? (
            <p className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'initiative.list.error' })}
            </p>
          ) : initiatives.length === 0 ? (
            <div className='rounded-lg border border-dashed p-8 text-center'>
              <Target className='mx-auto mb-3 size-6 text-muted-foreground' />
              <p className='text-sm font-medium'>
                {intl.formatMessage({ id: 'initiative.list.empty' })}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {intl.formatMessage({ id: 'initiative.list.emptyHint' })}
              </p>
            </div>
          ) : (
            <ul className='flex flex-col gap-2'>
              {initiatives.map(initiative => (
                <li key={initiative.id}>
                  <Link
                    href={`/workspace/${workspaceUrl}/initiatives/${initiative.id}`}
                    className='flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:bg-accent/50'
                  >
                    <div className='flex items-center gap-3'>
                      <span className='font-mono text-xs text-muted-foreground'>
                        {initiative.identifier}
                      </span>
                      <Badge variant={STATUS_VARIANT[initiative.status]}>
                        {intl.formatMessage({
                          id: STATUS_KEY[initiative.status],
                        })}
                      </Badge>
                    </div>
                    <p className='font-medium leading-snug'>
                      {initiative.goalStatement}
                    </p>
                    <div className='flex items-center gap-4 text-xs text-muted-foreground'>
                      <span className='flex items-center gap-1'>
                        <ListChecks className='size-3.5' />
                        {intl.formatMessage(
                          { id: 'initiative.list.taskCount' },
                          { count: initiative.taskCount }
                        )}
                      </span>
                      <span className='flex items-center gap-1'>
                        <Lightbulb className='size-3.5' />
                        {intl.formatMessage(
                          { id: 'initiative.list.ideaCount' },
                          { count: initiative.ideaCount }
                        )}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
