'use client'

import { Sparkles } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIntl } from 'react-intl'
import type { PrioritySuggestion } from '../../hooks/usePrioritySuggestion'
import type { ApiPriority } from '../../types'
import { PRIORITY_CONFIG, PRIORITY_LABEL_ID, PriorityDot } from './shared'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'

export interface AiPrioritySelectProps {
  value: ApiPriority
  onChange: (v: ApiPriority) => void
  triggerClassName?: string
  /**
   * The AI suggestion to offer as a hint (LUM-1284). It never fills the field
   * on its own: the hint applies it via `onChange` only when clicked. Pass
   * null once the user has picked a value so the hint goes away.
   */
  suggestion: PrioritySuggestion | null
  isLoadingSuggestion: boolean
  overrideRecorded: boolean
}

export function AiPrioritySelect({
  value,
  onChange,
  triggerClassName,
  suggestion,
  isLoadingSuggestion,
  overrideRecorded,
}: AiPrioritySelectProps) {
  const intl = useIntl()
  const label = intl.formatMessage({
    id: PRIORITY_LABEL_ID[value] ?? PRIORITY_LABEL_ID.NONE,
  })

  const suggestedLabel = suggestion
    ? PRIORITY_LABEL_ID[suggestion.priority]
      ? intl.formatMessage({ id: PRIORITY_LABEL_ID[suggestion.priority] })
      : suggestion.priority
    : ''

  const tooltipContent = suggestion ? (
    <div className='space-y-1.5 text-caption max-w-64'>
      <div>
        {intl.formatMessage(
          { id: 'priority.recommended' },
          { priority: suggestedLabel }
        )}
      </div>
      <div className='text-muted-foreground italic'>
        &quot;{suggestion.reason}&quot;
      </div>
      {suggestion.stats.total > 0 && (
        <>
          <div className='text-muted-foreground'>
            {intl.formatMessage(
              { id: 'priority.similarTasks' },
              { count: suggestion.stats.total }
            )}{' '}
            {Object.entries(suggestion.stats.distribution)
              .map(([k, v]) => `${k} ×${v}`)
              .join(', ')}
          </div>
          {suggestion.similarTasks.map(t => (
            <div key={t.id} className='text-muted-foreground'>
              • #{t.number} {t.title} — {t.priority}
            </div>
          ))}
        </>
      )}
    </div>
  ) : null

  return (
    <div className='flex items-center gap-1'>
      <Select value={value} onValueChange={v => onChange(v as ApiPriority)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger className={triggerClassName}>
              <div className='flex items-center gap-1.5'>
                <PriorityDot priority={value} />
                <span>{label}</span>
              </div>
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent>Priority</TooltipContent>
        </Tooltip>
        <SelectContent>
          {(
            Object.entries(PRIORITY_CONFIG) as [
              ApiPriority,
              (typeof PRIORITY_CONFIG)[ApiPriority],
            ][]
          ).map(([val]) => (
            <SelectItem key={val} value={val}>
              <div className='flex items-center gap-2'>
                <PriorityDot priority={val} />
                {intl.formatMessage({ id: PRIORITY_LABEL_ID[val] })}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isLoadingSuggestion && (
        <Spinner className='size-3 text-muted-foreground' />
      )}

      {!isLoadingSuggestion &&
        suggestion &&
        !overrideRecorded &&
        suggestion.priority !== value && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='gap-1 px-1.5 text-info-text [&_svg]:size-3'
                aria-label={intl.formatMessage(
                  { id: 'priority.applyAiSuggestion' },
                  { priority: suggestedLabel }
                )}
                onClick={() => onChange(suggestion.priority)}
              >
                <Sparkles />
                <span>{intl.formatMessage({ id: 'priority.aiSuggests' })}</span>
                <PriorityDot priority={suggestion.priority} />
                <span>{suggestedLabel}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' align='start'>
              {tooltipContent}
            </TooltipContent>
          </Tooltip>
        )}

      {overrideRecorded && (
        <span className='text-caption text-success-text animate-fade-out'>
          {intl.formatMessage({ id: 'priority.preferenceRecorded' })}
        </span>
      )}
    </div>
  )
}
