'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react'
import { SimilarTaskMatch } from '@/lib/similarity'
import { ApiTask } from '../types'
import { slugifyProjectName } from '../utils'

interface DuplicateWarningProps {
  matches: SimilarTaskMatch<ApiTask>[]
  workspaceUrl: string
  projects: { id: string; name: string }[]
}

export function DuplicateWarning({
  matches,
  workspaceUrl,
  projects,
}: DuplicateWarningProps) {
  const [expanded, setExpanded] = useState(false)

  if (matches.length === 0) return null

  return (
    <div className='rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30'>
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        className='w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 dark:text-amber-400'
      >
        <AlertTriangle className='size-4 shrink-0' />
        <span>发现 {matches.length} 个相似任务</span>
        {expanded ? (
          <ChevronUp className='size-4 ml-auto shrink-0' />
        ) : (
          <ChevronDown className='size-4 ml-auto shrink-0' />
        )}
      </button>
      {expanded && (
        <div className='px-3 pb-2 space-y-1'>
          {matches.map(({ task, score }) => {
            const projectName =
              task.project?.name ??
              projects.find(p => p.id === task.projectId)?.name ??
              ''
            const slug = slugifyProjectName(projectName)
            const identifier = `${task.teamIdentifier}-${task.number}`
            const url = `/workspace/${workspaceUrl}/project/${slug}/tasks/${identifier}`

            return (
              <button
                key={task.id}
                type='button'
                onClick={() => window.open(url, '_blank')}
                className='w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors'
              >
                <span className='text-amber-600 dark:text-amber-500 font-medium tabular-nums shrink-0'>
                  {Math.round(score * 100)}%
                </span>
                <span className='truncate text-zinc-700 dark:text-zinc-300'>
                  {task.title}
                </span>
                <span className='text-zinc-400 shrink-0'>{identifier}</span>
                <ExternalLink className='size-3 text-zinc-400 shrink-0 ml-auto' />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
