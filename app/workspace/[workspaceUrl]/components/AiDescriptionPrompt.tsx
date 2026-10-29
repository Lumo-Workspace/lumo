'use client'

import { useState, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { apiFetch, ApiClientError } from '@/lib/api-client'
import { isAiOffCode } from '@/lib/ai-features/registry'
import { RichHtml } from '@/components/RichHtml'
import { Spinner } from '@/components/ui/spinner'

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
      // LUM-1338: AI switched off or not configured — say so, not the raw error.
      setError(
        err instanceof ApiClientError && isAiOffCode(err.code)
          ? intl.formatMessage({ id: 'aiFeatures.error.unavailable' })
          : err instanceof Error
            ? err.message
            : 'Something went wrong'
      )
      setState('idle')
    }
  }, [
    title,
    projectId,
    workspaceUrl,
    existingDescription,
    onProjectSuggested,
    intl,
  ])

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
      <div className='rounded-lg border-2 border-dashed border-info-border bg-info-subtle px-4 py-3'>
        <div className='flex items-center gap-2.5'>
          <Spinner className='text-info-text' />
          <span className='text-body text-info-text'>
            {intl.formatMessage({ id: 'aiDesc.generating' })}
          </span>
        </div>
      </div>
    )
  }

  // Preview state
  if (state === 'preview' && preview) {
    return (
      <Card className='border-info-border p-4'>
        <div className='mb-2 text-caption font-semibold text-info-text'>
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
            className='rounded-md bg-primary px-3 py-1.5 text-caption text-primary-foreground hover:bg-primary/90 transition-colors'
          >
            {intl.formatMessage({ id: 'aiDesc.useThis' })}
          </button>
          <button
            type='button'
            onClick={handleGenerate}
            className='rounded-md border border-info-border px-3 py-1.5 text-caption text-info-text hover:bg-info/15 transition-colors'
          >
            ↻ {intl.formatMessage({ id: 'aiDesc.regenerate' })}
          </button>
          <button
            type='button'
            onClick={handleCancel}
            className='rounded-md border border-border px-3 py-1.5 text-caption text-muted-foreground hover:bg-muted transition-colors'
          >
            {intl.formatMessage({ id: 'aiDesc.cancel' })}
          </button>
        </div>
      </Card>
    )
  }

  // Error display (shown briefly, then back to idle prompt)
  const errorBanner = error ? (
    <Alert variant='danger' size='sm' className='mb-2'>
      <CircleAlert />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null

  // Refine mode: small button
  if (isRefineMode) {
    return (
      <div>
        {errorBanner}
        <button
          type='button'
          onClick={handleGenerate}
          className='flex items-center gap-1 rounded-md border border-info-border bg-info-subtle px-2.5 py-1 text-caption text-info-text hover:bg-info/15 transition-colors'
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
          'border-info-border bg-info-subtle hover:bg-info/15'
        )}
      >
        <span className='flex size-6 items-center justify-center rounded-full bg-info text-body text-info-foreground'>
          ✦
        </span>
        <div className='flex-1'>
          <div className='text-body-strong text-info-text'>
            {intl.formatMessage({ id: 'aiDesc.generate' })}
          </div>
          <div className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'aiDesc.generateHint' })}
          </div>
        </div>
        <span className='text-info-text'>→</span>
      </button>
    </div>
  )
}
