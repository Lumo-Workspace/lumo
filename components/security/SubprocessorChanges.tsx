'use client'

import { useIntl } from 'react-intl'

import { noticeDays } from '@/lib/legal/subprocessor-change-log'
import type { DataLocation } from '@/lib/legal/subprocessors'
import {
  NOTICE_PERIOD_DAYS,
  PRIVACY_CONTACT_EMAIL,
  type SubprocessorChange,
  type SubprocessorRef,
} from '@/lib/legal/subprocessor-changes'

interface SubprocessorChangesProps {
  /** Announced, not yet in effect — soonest first. */
  pending: readonly SubprocessorChange[]
  /** Recently in effect — newest first. */
  recent: readonly SubprocessorChange[]
}

const P = 'security.subprocessors.changes'

function refName(ref: SubprocessorRef): string {
  return ref.list === 'infrastructure'
    ? `${ref.entry.product} (${ref.entry.entity})`
    : ref.entry.entity
}

function refLocation(ref: SubprocessorRef): {
  location: DataLocation
  region?: string | undefined
} {
  return ref.list === 'infrastructure'
    ? { location: ref.entry.location, region: ref.entry.region }
    : { location: ref.entry.location }
}

/**
 * LUM-919: the DPA 7.2 change notices on /security — what is announced and
 * not yet in effect, and what changed recently. Wording is translated; the
 * names are proper nouns and the summary is the record's English text.
 */
export function SubprocessorChanges({
  pending,
  recent,
}: SubprocessorChangesProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values)
  const day = (iso: string) =>
    intl.formatDate(`${iso}T00:00:00Z`, { dateStyle: 'long', timeZone: 'UTC' })
  const location = (ref: SubprocessorRef) => {
    const { location: loc, region } = refLocation(ref)
    const label = t(`security.subprocessors.location.${loc}`)
    return region ? `${label} (${region})` : label
  }
  const category = (ref: SubprocessorRef) =>
    t(
      ref.list === 'infrastructure'
        ? 'security.subprocessors.infra.heading'
        : 'security.subprocessors.ai.heading'
    )

  const item = (c: SubprocessorChange, isPending: boolean) => {
    const subject = c.after ?? c.before!
    const moved =
      c.kind === 'changed' &&
      c.before &&
      c.after &&
      location(c.before) !== location(c.after)
    return (
      <li key={c.id} className='rounded-md border border-border p-3'>
        <p className='flex flex-wrap items-baseline gap-x-2'>
          <span className='text-caption uppercase text-muted-foreground'>
            {t(`${P}.kind.${c.kind}`)}
          </span>
          <span className='text-title'>{refName(subject)}</span>
          {c.kind === 'replaced' && c.before ? (
            <span className='text-body text-muted-foreground'>
              {t(`${P}.replaces`, { name: refName(c.before) })}
            </span>
          ) : null}
        </p>
        <p className='mt-1 text-body'>
          {category(subject)} · {location(subject)}
        </p>
        {/* The record's own wording — the only place a purpose change is
            described. Written once, in English, like the legal doc. */}
        <p className='mt-1 text-body' lang='en'>
          {c.summary}
        </p>
        {moved ? (
          <p className='mt-1 text-body'>
            {t(`${P}.location`, {
              from: location(c.before!),
              to: location(c.after!),
            })}
          </p>
        ) : null}
        <p className='mt-1 text-body text-muted-foreground'>
          {isPending
            ? t(`${P}.pendingDates`, {
                announced: day(c.announcedAt),
                effective: day(c.effectiveAt),
              })
            : t(`${P}.recentDates`, { effective: day(c.effectiveAt) })}
        </p>
        {c.urgent && noticeDays(c) < NOTICE_PERIOD_DAYS ? (
          <p className='mt-1 text-body'>
            {t(`${P}.urgent`, { days: NOTICE_PERIOD_DAYS })}
          </p>
        ) : null}
      </li>
    )
  }

  const list = (
    changes: readonly SubprocessorChange[],
    isPending: boolean,
    empty: string
  ) =>
    changes.length > 0 ? (
      <ul className='space-y-2'>{changes.map(c => item(c, isPending))}</ul>
    ) : (
      <p className='text-body text-muted-foreground'>{t(empty)}</p>
    )

  return (
    <div id='subprocessor-changes' data-testid='subprocessor-changes'>
      <h3 className='mt-8 mb-2 text-title'>{t(`${P}.heading`)}</h3>
      <p className='mb-4 text-body text-muted-foreground'>
        {intl.formatMessage(
          { id: `${P}.intro` },
          {
            days: NOTICE_PERIOD_DAYS,
            email: (
              <a
                className='text-body-strong underline underline-offset-4'
                href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              >
                {PRIVACY_CONTACT_EMAIL}
              </a>
            ),
          }
        )}
      </p>
      <h4 className='mb-2 text-body-strong'>{t(`${P}.pending`)}</h4>
      <div data-testid='subprocessor-changes-pending'>
        {list(pending, true, `${P}.pendingEmpty`)}
      </div>
      <h4 className='mt-4 mb-2 text-body-strong'>{t(`${P}.recent`)}</h4>
      <div data-testid='subprocessor-changes-recent'>
        {list(recent, false, `${P}.recentEmpty`)}
      </div>
    </div>
  )
}
