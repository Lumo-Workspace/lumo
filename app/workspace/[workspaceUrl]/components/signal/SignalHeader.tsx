'use client'

import { useIntl } from 'react-intl'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  AnomalyCard,
  ClearNote,
  SignalView,
} from '@/lib/summaries/signal-view'
import type { RiskLevel } from '@/types/summary'
import { RiskBadge } from '../summary/RiskBadge'

interface SignalHeaderProps {
  level: RiskLevel | null
  headline: string
  view: SignalView
}

/**
 * Accent stripe per tone. The stripe and the tint carry the severity; the
 * number itself stays `text-foreground` because the bright accents fail AA as
 * text on the card surface — same rationale as RiskBadge.
 */
const TONE_STRIPE: Record<AnomalyCard['tone'], string> = {
  danger: 'border-t-danger',
  warning: 'border-t-warning',
}

function AnomalyMetricCard({ card }: { card: AnomalyCard }) {
  const intl = useIntl()
  return (
    <div
      data-testid={`signal-card-${card.key}`}
      className={cn(
        'rounded-lg border border-border border-t-[3px] bg-card px-5 py-4',
        TONE_STRIPE[card.tone]
      )}
    >
      <div className='text-display font-mono text-foreground'>{card.count}</div>
      <div className='text-body-strong text-foreground'>
        {intl.formatMessage({ id: `signal.metric.${card.key}` })}
      </div>
      <div className='text-caption text-muted-foreground'>
        {intl.formatMessage({ id: `signal.metric.${card.key}.hint` })}
      </div>
    </div>
  )
}

function ClearLine({ notes }: { notes: ClearNote[] }) {
  const intl = useIntl()
  if (notes.length === 0) return null

  return (
    <div className='flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 py-2 text-caption text-muted-foreground'>
      {notes.map(note => (
        <span
          key={note.key}
          className='inline-flex items-center gap-1.5'
          data-testid={`signal-clear-${note.key}`}
        >
          <Check className='h-3.5 w-3.5 text-success' aria-hidden />
          {note.kind === 'completion'
            ? intl.formatMessage(
                { id: 'signal.clear.completion' },
                { done: note.done, total: note.total }
              )
            : intl.formatMessage({ id: `signal.clear.${note.key}` })}
        </span>
      ))}
      <span className='text-muted-foreground/70'>
        {intl.formatMessage({ id: 'signal.clear.quiet' })}
      </span>
    </div>
  )
}

export function SignalHeader({ level, headline, view }: SignalHeaderProps) {
  return (
    <div className='space-y-4'>
      <div className='flex items-start gap-4'>
        <div className='shrink-0 pt-1'>
          <RiskBadge level={level} />
        </div>
        <h1 className='text-heading text-foreground text-pretty'>{headline}</h1>
      </div>

      {view.anomalies.length > 0 && (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          {view.anomalies.map(card => (
            <AnomalyMetricCard key={card.key} card={card} />
          ))}
        </div>
      )}

      <ClearLine notes={view.clear} />
    </div>
  )
}
