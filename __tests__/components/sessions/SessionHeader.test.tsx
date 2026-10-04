/** @jest-environment jsdom */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      for (const [k, v] of Object.entries(values ?? {})) {
        s = s.split(`{${k}}`).join(String(v))
      }
      return s
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { SessionHeader } from '@/app/sessions/[id]/SessionHeader'

const props = {
  id: 'sess-1',
  cwd: '/repo',
  startedAt: '2026-10-01 10:00',
  lastActivityAt: '2026-10-01 10:30',
  durationMin: 30,
  toolCallCount: 12,
}

describe('SessionHeader error count (LUM-934)', () => {
  it('colours a non-zero error count with the danger text token', () => {
    render(<SessionHeader {...props} errorCount={3} />)
    expect(screen.getByText('3')).toHaveClass('text-danger-text')
  })

  it('leaves a zero error count uncoloured', () => {
    render(<SessionHeader {...props} errorCount={0} />)
    expect(screen.getByText('0')).not.toHaveClass('text-danger-text')
  })
})
