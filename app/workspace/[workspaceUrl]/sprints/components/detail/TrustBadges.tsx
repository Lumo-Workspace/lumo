'use client'

import { useIntl } from 'react-intl'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import type { TaskTrust } from './view-model'

type Tone = NonNullable<BadgeProps['variant']>

const SECURITY: Record<TaskTrust['security'], { id: string; tone: Tone }> = {
  clear: { id: 'sprints.detail.trust.scanClear', tone: 'success' },
  blocked: { id: 'sprints.detail.trust.scanBlocked', tone: 'danger' },
  notScanned: { id: 'sprints.detail.trust.notScanned', tone: 'outline-muted' },
  unknown: { id: 'sprints.detail.trust.scanUnknown', tone: 'outline-muted' },
}

/**
 * A task's trust at a glance: test cases (all passing and fresh / partial /
 * none), blocking crossings, and the security plane. Values come straight from
 * the attention DTO; nothing is re-derived here.
 */
export function TrustBadges({
  testsPassing,
  testsTotal,
  testsFresh,
  crossingsBlocking,
  security,
}: TaskTrust) {
  const intl = useIntl()
  const sec = SECURITY[security]

  let tests: { label: string; tone: Tone }
  if (testsTotal === 0) {
    tests = {
      label: intl.formatMessage({ id: 'sprints.detail.trust.noTc' }),
      tone: 'warning',
    }
  } else if (testsFresh === testsTotal) {
    tests = {
      label: intl.formatMessage(
        { id: 'sprints.detail.trust.tc' },
        { passing: testsPassing, total: testsTotal }
      ),
      tone: 'success',
    }
  } else if (testsPassing === testsTotal) {
    tests = {
      label: intl.formatMessage(
        { id: 'sprints.detail.trust.tcStale' },
        { passing: testsPassing, total: testsTotal }
      ),
      tone: 'warning',
    }
  } else {
    tests = {
      label: intl.formatMessage(
        { id: 'sprints.detail.trust.tc' },
        { passing: testsPassing, total: testsTotal }
      ),
      tone: 'warning',
    }
  }

  return (
    <span className='inline-flex flex-wrap gap-1.5'>
      {crossingsBlocking > 0 && (
        <Badge variant='danger' size='sm'>
          {intl.formatMessage(
            { id: 'sprints.detail.trust.crossings' },
            { count: crossingsBlocking }
          )}
        </Badge>
      )}
      <Badge variant={tests.tone} size='sm'>
        {tests.label}
      </Badge>
      <Badge variant={sec.tone} size='sm'>
        {intl.formatMessage({ id: sec.id })}
      </Badge>
    </span>
  )
}
