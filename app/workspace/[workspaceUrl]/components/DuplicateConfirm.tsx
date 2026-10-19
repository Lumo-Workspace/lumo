'use client'

import { useIntl } from 'react-intl'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { slugify } from '@/lib/utils/slugify'
import { statusLabel } from '../utils/taskStatus'

export interface DuplicateMatch {
  taskId: string
  title: string
  number: number
  teamIdentifier: string
  status: string
  score: number
  assigneeName: string | null
  priority: string
}

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'P3',
  MEDIUM: 'P2',
  HIGH: 'P1',
  URGENT: 'P0',
}

function scoreBadgeClass(score: number): string {
  if (score >= 0.8) return 'text-danger-text'
  if (score >= 0.6) return 'text-warning-text'
  return 'text-muted-foreground'
}

interface DuplicateConfirmProps {
  matches: DuplicateMatch[]
  projectName: string
  workspaceUrl: string
  onConfirm: () => void
  onCancel: () => void
}

export function DuplicateConfirm({
  matches,
  projectName,
  workspaceUrl,
  onConfirm,
  onCancel,
}: DuplicateConfirmProps) {
  const intl = useIntl()
  const projectSlug = slugify(projectName)

  return (
    <div className='space-y-4'>
      {/* Warning banner */}
      <div className='flex items-center gap-2 px-4 py-3 rounded-lg border border-warning-border bg-warning-subtle text-body text-warning-text'>
        <AlertTriangle className='size-4 shrink-0' />
        <span>
          {intl.formatMessage(
            { id: 'duplicate.confirmMessage' },
            { count: matches.length }
          )}
        </span>
      </div>

      {/* Match list */}
      <div className='space-y-2'>
        {matches.map(match => {
          const identifier = `${match.teamIdentifier}-${match.number}`
          const url = `/workspace/${workspaceUrl}/projects/${projectSlug}/tasks/${identifier}`

          return (
            <div
              key={match.taskId}
              className='flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-muted/50'
            >
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2 mb-1'>
                  <span
                    className={`text-caption font-semibold tabular-nums ${scoreBadgeClass(match.score)}`}
                  >
                    {intl.formatMessage(
                      { id: 'duplicate.match' },
                      { score: Math.round(match.score * 100) }
                    )}
                  </span>
                  <span className='text-body-strong text-foreground truncate'>
                    {match.title}
                  </span>
                </div>
                <div className='flex items-center gap-1 text-caption text-muted-foreground'>
                  <span>{identifier}</span>
                  <span>·</span>
                  <span>{statusLabel(intl, match.status)}</span>
                  {match.assigneeName && (
                    <>
                      <span>·</span>
                      <span>{match.assigneeName}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {PRIORITY_LABEL[match.priority] ?? match.priority}
                  </span>
                </div>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => window.open(url, '_blank')}
                className='shrink-0'
              >
                {intl.formatMessage({ id: 'duplicate.view' })}
                <ExternalLink className='size-3 ml-1' />
              </Button>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className='flex items-center gap-3 pt-2'>
        <Button onClick={onConfirm}>
          {intl.formatMessage({ id: 'duplicate.createAnyway' })}
        </Button>
        <Button variant='ghost' onClick={onCancel}>
          {intl.formatMessage({ id: 'newTask.cancel' })}
        </Button>
      </div>
    </div>
  )
}
