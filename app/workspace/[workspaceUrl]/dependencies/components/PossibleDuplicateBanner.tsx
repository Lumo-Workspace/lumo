'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import { CopyCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useDependencies } from '../../hooks/useDependencies'
import { selectSuggestedDuplicates } from '../groupDependencies'

interface PossibleDuplicateBannerProps {
  taskIdentifier: string
  workspaceUrl: string
}

/**
 * LUM-1286: the tasks this one likely duplicates, under the task title, so a
 * human can rule on them without opening the dependency dialog. Shares the
 * dependency query with the sidebar field, so a ruling here updates both.
 */
export function PossibleDuplicateBanner({
  taskIdentifier,
  workspaceUrl,
}: PossibleDuplicateBannerProps) {
  const intl = useIntl()
  const { edges, patch } = useDependencies({ taskId: taskIdentifier })
  const duplicates = selectSuggestedDuplicates(edges)
  if (duplicates.length === 0) return null

  return (
    <Alert className='mb-4 [&>svg]:text-muted-foreground'>
      <CopyCheck />
      <AlertTitle>
        {intl.formatMessage({ id: 'task.possibleDuplicate.title' })}
      </AlertTitle>
      <AlertDescription>
        <p className='text-muted-foreground'>
          {intl.formatMessage({ id: 'task.possibleDuplicate.description' })}
        </p>
        <ul className='mt-2 flex flex-col gap-2'>
          {duplicates.map(e => {
            const score = (e.detail as { score?: number } | null)?.score
            return (
              <li
                key={e.id}
                className='flex flex-wrap items-center gap-x-2 gap-y-1'
              >
                <span className='font-mono text-caption text-muted-foreground'>
                  {e.other.identifier}
                </span>
                <span className='min-w-0 flex-1 truncate'>{e.other.title}</span>
                {typeof score === 'number' && (
                  <span className='text-caption text-muted-foreground'>
                    {intl.formatMessage(
                      { id: 'task.possibleDuplicate.score' },
                      { score: Math.round(score * 100) }
                    )}
                  </span>
                )}
                <span className='flex items-center gap-1'>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={patch.isPending}
                    onClick={() =>
                      patch.mutate({ depId: e.id, action: 'confirm' })
                    }
                  >
                    {intl.formatMessage({
                      id: 'task.possibleDuplicate.confirm',
                    })}
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={patch.isPending}
                    onClick={() =>
                      patch.mutate({ depId: e.id, action: 'dismiss' })
                    }
                  >
                    {intl.formatMessage({
                      id: 'task.possibleDuplicate.dismiss',
                    })}
                  </Button>
                  <Button size='sm' variant='ghost' asChild>
                    <Link
                      href={`/workspace/${workspaceUrl}/my-tasks/${e.other.identifier}`}
                    >
                      {intl.formatMessage({
                        id: 'task.possibleDuplicate.open',
                      })}
                    </Link>
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
