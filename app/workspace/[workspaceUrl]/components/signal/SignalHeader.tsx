'use client'

import { useIntl } from 'react-intl'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  AnomalyCard,
  ClearNote,
  SignalView,
} from '@/lib/summaries/signal-view'

interface SignalHeaderProps {
  view: SignalView
}

/**
 * Accent mark per tone. The mark carries the severity; the number itself stays
 * `text-foreground` because the bright accents fail AA as text on the card
 * surface.
 *
 * Drawn as its own element rather than a coloured `border-top`: this build
 * doesn't generate side-specific border-colour utilities (`border-t-danger`
 * resolves to nothing), and even where it did, a blanket `border-border` would
 * race it on stylesheet order. A background block is unambiguous.
 */
const TONE_ACCENT: Record<AnomalyCard['tone'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
}

function AnomalyMetricCard({ card }: { card: AnomalyCard }) {
  const intl = useIntl()
  return (
    <div
      data-testid={`signal-card-${card.key}`}
      className='w-full rounded-lg border border-border bg-card px-6 py-5 shadow-elevation-1 sm:w-[300px]'
    >
      {/* Short pill inset in the padding, not a full-bleed edge stripe: it reads
          as a mark on the card rather than a status bar spanning the surface. */}
      <div
        className={cn('h-1 w-8 rounded-sm', TONE_ACCENT[card.tone])}
        aria-hidden
      />
      {/* The count is the card's whole point, so it gets display weight well
          past the type scale's top tier. `tabular-nums` keeps digits aligned
          across the row now that it is no longer set in mono. */}
      <div className='mt-3.5 text-[42px] font-semibold leading-none tracking-tight tabular-nums text-foreground'>
        {card.count}
      </div>
      <div className='mt-2 text-title text-foreground'>
        {intl.formatMessage({ id: `signal.metric.${card.key}` })}
      </div>
      <div className='mt-0.5 text-caption text-muted-foreground'>
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

export function SignalHeader({ view }: SignalHeaderProps) {
  return (
    <div className='space-y-4'>
      {view.anomalies.length > 0 && (
        /* Fixed-width cards in a wrapping row rather than a stretching grid:
           a lone anomaly stays a card, not a banner across the page. */
        <div className='flex flex-wrap gap-5'>
          {view.anomalies.map(card => (
            <AnomalyMetricCard key={card.key} card={card} />
          ))}
        </div>
      )}

      <ClearLine notes={view.clear} />
    </div>
  )
}
