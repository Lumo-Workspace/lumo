'use client'

import { useState, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'
import { RichHtml } from '@/components/RichHtml'

type PromptState = 'idle' | 'loading' | 'preview'

interface SuggestedProject {
  id: string
  name: string
  reason: string
}

interface AiDescriptionPromptProps {
  title: string
  projectId: string
  workspaceUrl: string
  existingDescription: string | null
  onAccept: (html: string) => void
  onProjectSuggested?: (project: SuggestedProject) => void
}

export function AiDescriptionPrompt({
  title,
  projectId,
  workspaceUrl,
  existingDescription,
  onAccept,
  onProjectSuggested,
}: AiDescriptionPromptProps) {
  const intl = useIntl()
  const [state, setState] = useState<PromptState>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isRefineMode = !!existingDescription
  const titleTooShort = title.trim().length < 3

  const handleGenerate = useCallback(async () => {
    setError(null)
    setState('loading')
    try {
      const data = await apiFetch<{
        description?: string
        suggestedProject?: SuggestedProject
      }>('/api/tasks/generate-description', {
        method: 'POST',
        body: {
          title: title.trim(),
          ...(projectId ? { projectId } : { workspaceUrl }),
          ...(existingDescription && { existingDescription }),
        },
      })
      if (!data.description) {
        throw new Error('Failed to generate description')
      }
      setPreview(data.description)
      setState('preview')

      // Notify parent about suggested project
      if (data.suggestedProject && onProjectSuggested) {
        onProjectSuggested(data.suggestedProject)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('idle')
    }
  }, [title, projectId, workspaceUrl, existingDescription, onProjectSuggested])

  const handleAccept = useCallback(() => {
    if (preview) {
      onAccept(preview)
    }
    setPreview(null)
    setState('idle')
  }, [preview, onAccept])

  const handleCancel = useCallback(() => {
    setPreview(null)
    setState('idle')
  }, [])

  // Don't render anything if title is too short
  if (titleTooShort) return null

  // Loading state
  if (state === 'loading') {
    return (
      <div className='rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-950/30'>
        <div className='flex items-center gap-2.5'>
          <Loader2 className='size-4 animate-spin text-indigo-500' />
          <span className='text-sm text-indigo-600 dark:text-indigo-400'>
            {intl.formatMessage({ id: 'aiDesc.generating' })}
          </span>
        </div>
      </div>
    )
  }

  // Preview state
  if (state === 'preview' && preview) {
    return (
      <div className='rounded-lg border border-indigo-300 bg-card p-4 dark:border-indigo-800'>
        <div className='mb-2 text-xs font-semibold text-indigo-500'>
          ✦ {intl.formatMessage({ id: 'aiDesc.preview' })}
        </div>
        <RichHtml
          className='prose prose-sm max-w-none text-foreground dark:prose-invert'
          html={preview}
        />
        <div className='mt-3 flex gap-2'>
          <button
            type='button'
            onClick={handleAccept}
            className='rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 transition-colors'
          >
            {intl.formatMessage({ id: 'aiDesc.useThis' })}
          </button>
          <button
            type='button'
            onClick={handleGenerate}
            className='rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-500 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-950/50 transition-colors'
          >
            ↻ {intl.formatMessage({ id: 'aiDesc.regenerate' })}
          </button>
          <button
            type='button'
            onClick={handleCancel}
            className='rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors'
          >
            {intl.formatMessage({ id: 'aiDesc.cancel' })}
          </button>
        </div>
      </div>
    )
  }

  // Error display (shown briefly, then back to idle prompt)
  const errorBanner = error ? (
    <div className='mb-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400'>
      {error}
    </div>
  ) : null

  // Refine mode: small button
  if (isRefineMode) {
    return (
      <div>
        {errorBanner}
        <button
          type='button'
          onClick={handleGenerate}
          className='flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-500 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-400 dark:hover:bg-indigo-950/50 transition-colors'
        >
          <span>✦</span>
          <span>{intl.formatMessage({ id: 'aiDesc.refine' })}</span>
        </button>
      </div>
    )
  }

  // Generate mode: prompt card
  return (
    <div>
      {errorBanner}
      <button
        type='button'
        onClick={handleGenerate}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-left transition-colors',
          'border-indigo-300 bg-indigo-50 hover:bg-indigo-100',
          'dark:border-indigo-800 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50'
        )}
      >
        <span className='flex size-6 items-center justify-center rounded-full bg-indigo-500 text-sm text-white'>
          ✦
        </span>
        <div className='flex-1'>
          <div className='text-sm font-semibold text-indigo-600 dark:text-indigo-400'>
            {intl.formatMessage({ id: 'aiDesc.generate' })}
          </div>
          <div className='text-xs text-muted-foreground'>
            {intl.formatMessage({ id: 'aiDesc.generateHint' })}
          </div>
        </div>
        <span className='text-indigo-500'>→</span>
      </button>
    </div>
  )
}
