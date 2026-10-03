'use client'

import { useIntl, type IntlShape } from 'react-intl'
import type {
  AttributionConfidenceName,
  EvidenceView,
  RunAttribution,
  RunSegmentView,
  RunSubagentView,
} from '../../types'
import {
  APPROXIMATE_LABEL,
  APPROXIMATE_NOTICE,
  CONFIDENCE_MESSAGES,
  FOLLOWS_PARENT,
  MODE_MESSAGES,
  NO_SIGNAL,
  PANEL_TITLE,
  SIGNAL_MESSAGES,
  SOURCE_MESSAGES,
  SUBAGENTS_MESSAGE,
  SUBAGENT_UNKNOWN_TYPE,
  TURNS_MESSAGE,
  TURN_MESSAGE,
} from './attribution-labels'

function weakestConfidence(
  attribution: RunAttribution
): AttributionConfidenceName | null {
  const all = [...attribution.segments, ...attribution.subagents]
  if (all.length === 0) return null
  return all.some(x => x.confidence === 'MEDIUM') ? 'MEDIUM' : 'HIGH'
}

export function RunAttributionBadge({
  attribution,
}: {
  attribution: RunAttribution
}) {
  const intl = useIntl()
  let text = intl.formatMessage(MODE_MESSAGES[attribution.mode])
  if (attribution.mode === 'INFERRED') {
    const weakest = weakestConfidence(attribution)
    if (weakest) {
      text += ` · ${intl.formatMessage(CONFIDENCE_MESSAGES[weakest])}`
    }
  }
  return (
    <>
      <span
        data-testid='run-attribution-badge'
        className='px-2 py-0.5 rounded-md border border-border text-caption leading-4 text-muted-foreground shrink-0'
      >
        {text}
      </span>
      {attribution.approximate && (
        <span
          data-testid='run-approximate'
          title={intl.formatMessage(APPROXIMATE_NOTICE)}
          className='px-2 py-0.5 rounded-md border border-border text-caption leading-4 text-amber-700 dark:text-amber-400 shrink-0'
        >
          {intl.formatMessage(APPROXIMATE_LABEL)}
        </span>
      )}
    </>
  )
}

function EvidenceLines({
  intl,
  evidence,
}: {
  intl: IntlShape
  evidence: EvidenceView[]
}) {
  return (
    <>
      {evidence.map((e, i) => (
        <div
          key={`${e.kind}-${e.identifier}-${i}`}
          className='pl-3 text-caption text-muted-foreground'
        >
          {intl.formatMessage(SIGNAL_MESSAGES[e.kind])} · {e.identifier} ·{' '}
          {new Date(e.at).toLocaleTimeString(intl.locale, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </div>
      ))}
    </>
  )
}

function turnLabel(intl: IntlShape, seg: RunSegmentView): string {
  if (seg.fromTurn === seg.toTurn) {
    return intl.formatMessage(TURN_MESSAGE, { n: seg.fromTurn + 1 })
  }
  return intl.formatMessage(TURNS_MESSAGE, {
    fromN: seg.fromTurn + 1,
    toN: seg.toTurn + 1,
  })
}

function SegmentRow({ intl, seg }: { intl: IntlShape; seg: RunSegmentView }) {
  return (
    <div data-testid='attribution-segment' className='py-1'>
      <div className='text-caption'>
        {turnLabel(intl, seg)} ·{' '}
        {intl.formatMessage(SOURCE_MESSAGES[seg.source])} ·{' '}
        {intl.formatMessage(CONFIDENCE_MESSAGES[seg.confidence])}
      </div>
      {seg.evidence.length > 0 ? (
        <EvidenceLines intl={intl} evidence={seg.evidence} />
      ) : seg.source === 'INFERRED' ? (
        <div className='pl-3 text-caption text-muted-foreground'>
          {intl.formatMessage(NO_SIGNAL)}
        </div>
      ) : null}
    </div>
  )
}

function SubagentRow({ intl, sub }: { intl: IntlShape; sub: RunSubagentView }) {
  return (
    <div data-testid='attribution-subagent' className='py-1'>
      <div className='text-caption'>
        {sub.agentType ?? intl.formatMessage(SUBAGENT_UNKNOWN_TYPE)} ·{' '}
        {intl.formatMessage(SOURCE_MESSAGES[sub.source])} ·{' '}
        {intl.formatMessage(CONFIDENCE_MESSAGES[sub.confidence])}
      </div>
      {sub.followsParent && (
        <div className='pl-3 text-caption text-muted-foreground'>
          {intl.formatMessage(FOLLOWS_PARENT)}
        </div>
      )}
      {sub.evidence.length > 0 ? (
        <EvidenceLines intl={intl} evidence={sub.evidence} />
      ) : sub.source === 'INFERRED' ? (
        <div className='pl-3 text-caption text-muted-foreground'>
          {intl.formatMessage(NO_SIGNAL)}
        </div>
      ) : null}
    </div>
  )
}

export function RunAttributionPanel({
  attribution,
}: {
  attribution: RunAttribution
}) {
  const intl = useIntl()
  const syntheticExplicit =
    attribution.mode === 'EXPLICIT' && attribution.segments.length === 0
  return (
    <div data-testid='run-attribution-panel' className='mb-2 space-y-1'>
      <div className='text-caption font-semibold'>
        {intl.formatMessage(PANEL_TITLE)}
      </div>
      {attribution.approximate && (
        <div
          data-testid='run-approximate-notice'
          className='rounded-md border border-border px-2 py-1 text-caption text-amber-700 dark:text-amber-400'
        >
          {intl.formatMessage(APPROXIMATE_NOTICE)}
        </div>
      )}
      {syntheticExplicit && (
        <div data-testid='attribution-segment' className='py-1'>
          <div className='text-caption'>
            {intl.formatMessage(SOURCE_MESSAGES.SESSION_ATTACH)} ·{' '}
            {intl.formatMessage(CONFIDENCE_MESSAGES.EXPLICIT)}
          </div>
        </div>
      )}
      {attribution.segments.map((seg, i) => (
        <SegmentRow key={`seg-${i}`} intl={intl} seg={seg} />
      ))}
      {attribution.subagents.length > 0 && (
        <div className='pt-1'>
          <div className='text-caption font-medium text-muted-foreground'>
            {intl.formatMessage(SUBAGENTS_MESSAGE)}
          </div>
          {attribution.subagents.map(sub => (
            <SubagentRow key={sub.sessionId} intl={intl} sub={sub} />
          ))}
        </div>
      )}
    </div>
  )
}
