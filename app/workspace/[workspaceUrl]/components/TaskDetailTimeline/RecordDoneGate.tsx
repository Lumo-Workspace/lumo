'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Check, X } from 'lucide-react'
import type { DoneGate } from '@/lib/acceptance/done-gate'

export interface RecordDoneGateProps {
  gate: DoneGate
  /** Anchor of the Needs action section the blocked rows link to; null when
   *  that section is not on the page (nothing to act on). */
  queueAnchor: string | null
}

function GateIcon({ blocked }: { blocked: boolean }) {
  return blocked ? (
    <span className='inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-danger-subtle'>
      <X className='size-3 text-danger-text' aria-hidden />
    </span>
  ) : (
    <span className='inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted'>
      <Check className='size-3 text-muted-foreground' aria-hidden />
    </span>
  )
}

function GateRow({
  testId,
  label,
  blocked,
  detail,
  queueAnchor,
}: {
  testId: string
  label: string
  blocked: boolean
  detail: ReactNode
  queueAnchor: string | null
}) {
  const intl = useIntl()
  return (
    <div
      data-testid={testId}
      data-blocked={blocked}
      className='flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-5 py-3'
    >
      <GateIcon blocked={blocked} />
      <span className='w-40 shrink-0 text-body-strong text-foreground'>
        {label}
      </span>
      <span className='min-w-0 grow basis-48 text-body text-muted-foreground'>
        {detail}
      </span>
      {blocked && queueAnchor ? (
        <a
          href={`#${queueAnchor}`}
          className='text-caption font-medium text-foreground hover:underline'
        >
          {intl.formatMessage({ id: 'record.gate.goAct' })}
        </a>
      ) : null}
    </div>
  )
}

/**
 * LUM-1009 · ① the Done gate: always on the Record tab. A headline that says
 * whether the task can reach Done, then one row per gate. On a DONE task it
 * collapses to a single settled line. Purely presentational over `DoneGate`.
 */
export function RecordDoneGate({ gate, queueAnchor }: RecordDoneGateProps) {
  const intl = useIntl()
  const { crossings, security, tests } = gate

  const crossingsDetail =
    crossings.state === 'none'
      ? intl.formatMessage({ id: 'record.gate.crossings.none' })
      : [
          crossings.blocking > 0
            ? intl.formatMessage(
                { id: 'record.gate.crossings.blocking' },
                { count: crossings.blocking }
              )
            : null,
          crossings.advisory > 0
            ? intl.formatMessage(
                { id: 'record.gate.crossings.advisory' },
                { count: crossings.advisory }
              )
            : null,
          intl.formatMessage(
            { id: 'record.gap.progress' },
            { done: crossings.dispositioned, total: crossings.total }
          ),
        ]
          .filter(Boolean)
          .join(' · ')

  // LUM-1062: null without a plugin security check — no detail, no row.
  const securityDetail =
    security === null
      ? null
      : security.state === 'blocked'
        ? intl.formatMessage(
            { id: 'record.gate.security.blocking' },
            { count: security.blocking }
          )
        : security.state === 'clear'
          ? intl.formatMessage({ id: 'record.gate.security.clear' })
          : intl.formatMessage({ id: 'record.gate.security.notScanned' })

  const testsDetail =
    tests.state === 'blocked'
      ? intl.formatMessage(
          { id: 'record.gate.tests.blocking' },
          { count: tests.blocking }
        )
      : tests.state === 'clear'
        ? intl.formatMessage(
            { id: 'record.gate.tests.clear' },
            { passing: tests.passing, total: tests.total }
          )
        : intl.formatMessage({ id: 'record.gate.tests.none' })

  if (gate.headline === 'accepted') {
    return (
      <section
        data-testid='record-done-gate'
        data-headline='accepted'
        className='flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success-border bg-success-subtle px-5 py-3.5'
      >
        <span className='inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-background'>
          <Check className='size-3 text-success-text' aria-hidden />
        </span>
        <span className='text-title text-foreground'>
          {intl.formatMessage({ id: 'record.gap.accepted' })}
        </span>
        <span className='min-w-0 grow basis-48 text-body text-foreground'>
          {[crossingsDetail, securityDetail, testsDetail]
            .filter(d => d !== null)
            .join(' · ')}
        </span>
      </section>
    )
  }

  const headline =
    gate.headline === 'blocked'
      ? intl.formatMessage(
          { id: 'record.gate.blocked' },
          { count: gate.blockingTotal }
        )
      : intl.formatMessage({ id: 'record.gap.none' })

  return (
    <section
      data-testid='record-done-gate'
      data-headline={gate.headline}
      aria-labelledby='record-done-gate-title'
      className='overflow-hidden rounded-lg border border-border'
    >
      <div className='px-5 pb-4 pt-4'>
        <div className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'record.gate.title' })}
        </div>
        <h3
          id='record-done-gate-title'
          className='mt-1 text-heading text-foreground'
        >
          {headline}
        </h3>
      </div>
      <GateRow
        testId='gate-crossings'
        label={intl.formatMessage({ id: 'boundary.panel.title' })}
        blocked={crossings.state === 'blocked'}
        detail={crossingsDetail}
        queueAnchor={queueAnchor}
      />
      {security !== null && securityDetail !== null ? (
        <GateRow
          testId='gate-security'
          label={intl.formatMessage({ id: 'securityScan.section.title' })}
          blocked={security.state === 'blocked'}
          detail={securityDetail}
          queueAnchor={queueAnchor}
        />
      ) : null}
      <GateRow
        testId='gate-tests'
        label={intl.formatMessage({ id: 'testCases.section.title' })}
        blocked={tests.state === 'blocked'}
        detail={testsDetail}
        queueAnchor={queueAnchor}
      />
    </section>
  )
}
