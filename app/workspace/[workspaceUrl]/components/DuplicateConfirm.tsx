'use client'

import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { slugifyProjectName } from '../utils'

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

const STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'P3',
  MEDIUM: 'P2',
  HIGH: 'P1',
  URGENT: 'P0',
}

function scoreBadgeClass(score: number): string {
  if (score >= 0.8) return 'text-red-600 dark:text-red-400'
  if (score >= 0.6) return 'text-amber-600 dark:text-amber-400'
  return 'text-zinc-500 dark:text-zinc-400'
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
  const projectSlug = slugifyProjectName(projectName)

  return (
    <div className='space-y-4'>
      {/* Warning banner */}
      <div className='flex items-center gap-2 px-4 py-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-700 dark:text-amber-400'>
        <AlertTriangle className='size-4 shrink-0' />
        <span>
          {matches.length} similar {matches.length === 1 ? 'task' : 'tasks'}{' '}
          found — are you sure you want to create a duplicate?
        </span>
      </div>

      {/* Match list */}
      <div className='space-y-2'>
        {matches.map(match => {
          const identifier = `${match.teamIdentifier}-${match.number}`
          const url = `/workspace/${workspaceUrl}/project/${projectSlug}/tasks/${identifier}`

          return (
            <div
              key={match.taskId}
              className='flex items-center gap-3 px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50'
            >
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2 mb-1'>
                  <span
                    className={`text-xs font-semibold tabular-nums ${scoreBadgeClass(match.score)}`}
                  >
                    {Math.round(match.score * 100)}% match
                  </span>
                  <span className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'>
                    {match.title}
                  </span>
                </div>
                <div className='flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500'>
                  <span>{identifier}</span>
                  <span>·</span>
                  <span>{STATUS_LABEL[match.status] ?? match.status}</span>
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
                View
                <ExternalLink className='size-3 ml-1' />
              </Button>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className='flex items-center gap-3 pt-2'>
        <Button onClick={onConfirm}>Create anyway</Button>
        <Button variant='ghost' onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
