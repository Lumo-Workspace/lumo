/** @jest-environment jsdom */
import '@testing-library/jest-dom'

jest.mock('react-intl', () => {
  const intl = {
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, string | number>
    ) => (values ? `${id}:${Object.values(values).join('/')}` : id),
  }
  return { useIntl: () => intl }
})

import { render, screen } from '@testing-library/react'
import { TrustBadges } from '@/app/workspace/[workspaceUrl]/sprints/components/detail/TrustBadges'

const base = {
  testsPassing: 2,
  testsTotal: 2,
  testsFresh: 2,
  crossingsBlocking: 0,
  security: 'clear' as const,
}

test('all passing and fresh reads green', () => {
  render(<TrustBadges {...base} />)
  expect(screen.getByText('sprints.detail.trust.tc:2/2').className).toContain(
    'success'
  )
})

test('a failing case never reads green, even if fresh counts look complete', () => {
  render(<TrustBadges {...base} testsPassing={1} />)
  const badge = screen.getByText('sprints.detail.trust.tc:1/2')
  expect(badge.className).toContain('warning')
  expect(badge.className).not.toContain('success')
})

test('passing but not fresh reads stale', () => {
  render(<TrustBadges {...base} testsFresh={1} />)
  expect(
    screen.getByText('sprints.detail.trust.tcStale:2/2').className
  ).toContain('warning')
})
