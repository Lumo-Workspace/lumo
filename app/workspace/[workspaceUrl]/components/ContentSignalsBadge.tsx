'use client'

import { useIntl } from 'react-intl'
import { ShieldAlert } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  INJECTION_SIGNAL_KINDS,
  isContentSignals,
  type InjectionSignalKind,
} from '@/shared/src/untrusted-content'

/**
 * LUM-783 — the warning badge a source card (Slack context, web link,
 * comment, memory, artifact) shows when its stored `contentSignals` is
 * non-null: the content carried instruction-shaped text or a wrapper-closing
 * tag when it was written. The hit is recorded on the SOURCE row, so the
 * badge sits on the card that carries the content, never on an agent.
 *
 * Renders nothing for `null` / `undefined` / an unparseable value, so every
 * card can pass the raw JSON column through unconditionally.
 */
interface Props {
  signals: unknown
  className?: string
}

const KIND_LABEL_ID: Record<InjectionSignalKind, string> = {
  IMPERATIVE: 'contentSignals.kind.imperative',
  HIDDEN_COMMENT: 'contentSignals.kind.hiddenComment',
  INVISIBLE_CHARS: 'contentSignals.kind.invisibleChars',
  ENCODED_BLOB: 'contentSignals.kind.encodedBlob',
  SCRIPT_LINK: 'contentSignals.kind.scriptLink',
}

export function ContentSignalsBadge({
  signals,
  className,
}: Props): React.ReactElement | null {
  const intl = useIntl()
  if (!isContentSignals(signals) || signals.total <= 0) return null

  const parts = INJECTION_SIGNAL_KINDS.filter(
    k => (signals.counts[k] ?? 0) > 0
  ).map(
    k => `${intl.formatMessage({ id: KIND_LABEL_ID[k] })} ×${signals.counts[k]}`
  )
  if (signals.wrapperEscapes > 0) {
    parts.push(
      `${intl.formatMessage({ id: 'contentSignals.kind.wrapperEscape' })} ×${signals.wrapperEscapes}`
    )
  }
  const label = intl.formatMessage({
    id: 'contentSignals.badge',
    defaultMessage: 'Suspected injection',
  })
  const tooltip = intl.formatMessage(
    {
      id: 'contentSignals.tooltip',
      defaultMessage:
        '{count, plural, one {# suspected instruction-like signal} other {# suspected instruction-like signals}} detected in this content: {details}. It is still shown and injected, but agents are told to treat it as data, not instructions.',
    },
    { count: signals.total, details: parts.join(', ') }
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid='content-signals-badge'
          className={`inline-flex items-center gap-1 rounded-sm border border-warning-border bg-warning-subtle px-1.5 py-0.5 text-[11px] font-medium text-warning ${className ?? ''}`}
        >
          <ShieldAlert size={12} aria-hidden='true' />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs'>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
