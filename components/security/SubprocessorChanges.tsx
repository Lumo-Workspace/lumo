'use client'

import { useIntl } from 'react-intl'

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
 * names are proper nouns from the change log.
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
          <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            {t(`${P}.kind.${c.kind}`)}
          </span>
          <span className='font-medium'>{refName(subject)}</span>
          {c.kind === 'replaced' && c.before ? (
            <span className='text-sm text-muted-foreground'>
              {t(`${P}.replaces`, { name: refName(c.before) })}
            </span>
          ) : null}
        </p>
        <p className='mt-1 text-sm'>
          {category(subject)} · {location(subject)}
        </p>
        {moved ? (
          <p className='mt-1 text-sm'>
            {t(`${P}.location`, {
              from: location(c.before!),
              to: location(c.after!),
            })}
          </p>
        ) : null}
        <p className='mt-1 text-sm text-muted-foreground'>
          {isPending
            ? t(`${P}.pendingDates`, {
                announced: day(c.announcedAt),
                effective: day(c.effectiveAt),
              })
            : t(`${P}.recentDates`, { effective: day(c.effectiveAt) })}
        </p>
        {c.urgent ? (
          <p className='mt-1 text-sm'>
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
      <p className='text-sm text-muted-foreground'>{t(empty)}</p>
    )

  return (
    <div id='subprocessor-changes' data-testid='subprocessor-changes'>
      <h3 className='mt-8 mb-2 text-base font-semibold'>{t(`${P}.heading`)}</h3>
      <p className='mb-4 text-sm text-muted-foreground'>
        {intl.formatMessage(
          { id: `${P}.intro` },
          {
            days: NOTICE_PERIOD_DAYS,
            email: (
              <a
                className='font-medium underline underline-offset-4'
                href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              >
                {PRIVACY_CONTACT_EMAIL}
              </a>
            ),
          }
        )}
      </p>
      <h4 className='mb-2 text-sm font-semibold'>{t(`${P}.pending`)}</h4>
      <div data-testid='subprocessor-changes-pending'>
        {list(pending, true, `${P}.pendingEmpty`)}
      </div>
      <h4 className='mt-4 mb-2 text-sm font-semibold'>{t(`${P}.recent`)}</h4>
      <div data-testid='subprocessor-changes-recent'>
        {list(recent, false, `${P}.recentEmpty`)}
      </div>
    </div>
  )
}
