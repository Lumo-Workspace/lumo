'use client'

import { Loader2, Sparkles } from 'lucide-react'
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
import { PRIORITY_CONFIG, PriorityIcon } from './shared'

export interface AiPrioritySelectProps {
  value: ApiPriority
  onChange: (v: ApiPriority) => void
  triggerClassName?: string
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
  const { label } = PRIORITY_CONFIG[value] ?? PRIORITY_CONFIG.MEDIUM

  const tooltipContent = suggestion ? (
    <div className='space-y-1.5 text-xs max-w-64'>
      <div className='font-medium'>
        {intl.formatMessage(
          { id: 'priority.recommended' },
          {
            priority:
              PRIORITY_CONFIG[suggestion.priority]?.label ??
              suggestion.priority,
          }
        )}
      </div>
      <div className='text-zinc-400 italic'>
        &quot;{suggestion.reason}&quot;
      </div>
      {suggestion.stats.total > 0 && (
        <>
          <div className='text-zinc-400'>
            {intl.formatMessage(
              { id: 'priority.similarTasks' },
              { count: suggestion.stats.total }
            )}{' '}
            {Object.entries(suggestion.stats.distribution)
              .map(([k, v]) => `${k} ×${v}`)
              .join(', ')}
          </div>
          {suggestion.similarTasks.map(t => (
            <div key={t.id} className='text-zinc-500'>
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
                <PriorityIcon priority={value} />
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
          ).map(([val, { label: lbl, Icon, iconColor }]) => (
            <SelectItem key={val} value={val}>
              <div className='flex items-center gap-2'>
                <span className={iconColor}>
                  <Icon className='size-4' />
                </span>
                {lbl}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isLoadingSuggestion && (
        <Loader2 className='size-3 animate-spin text-zinc-400' />
      )}

      {!isLoadingSuggestion && suggestion && !overrideRecorded && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex items-center gap-0.5 text-[10px] text-violet-500 cursor-default'>
              <Sparkles className='size-3' />
              {intl.formatMessage({ id: 'priority.aiRecommended' })}
            </span>
          </TooltipTrigger>
          <TooltipContent side='bottom' align='start'>
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      )}

      {overrideRecorded && (
        <span className='text-[10px] text-emerald-500 animate-fade-out'>
          {intl.formatMessage({ id: 'priority.preferenceRecorded' })}
        </span>
      )}
    </div>
  )
}
