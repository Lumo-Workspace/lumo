/** @jest-environment jsdom */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      `${id} ${JSON.stringify(values ?? {})}`,
  }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import { Timeline } from '@/app/sessions/[id]/Timeline'
import type { TimelineItem } from '@/app/sessions/[id]/merge-events'

const item = (over: Partial<TimelineItem>): TimelineItem => ({
  key: 'k',
  kind: 'tool',
  toolName: 'Bash',
  summary: 'ls',
  pruned: false,
  summaryMsg: null,
  badge: null,
  status: 'ok',
  startAt: new Date('2026-06-01T00:00:00Z'),
  endAt: null,
  details: [],
  ...over,
})

describe('Timeline localization', () => {
  it('renders a block label through intl', () => {
    render(
      <Timeline
        items={[
          item({
            details: [{ labelKey: 'command', variant: 'code', text: 'ls' }],
          }),
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(
      screen.getByText('sessions.timeline.block.command {}')
    ).toBeInTheDocument()
  })

  it('renders the pruned notice through intl instead of item.summary', () => {
    render(<Timeline items={[item({ pruned: true, summary: '' })]} />)
    expect(screen.getByText('sessions.timeline.pruned {}')).toBeInTheDocument()
  })

  it('renders a parametric badge through intl with its count', () => {
    render(<Timeline items={[item({ badge: { kind: 'lines', count: 3 } })]} />)
    expect(
      screen.getByText('sessions.timeline.badge.lines {"count":3}')
    ).toBeInTheDocument()
  })

  it('renders a parametric summary through intl instead of item.summary', () => {
    render(
      <Timeline
        items={[item({ summary: '', summaryMsg: { kind: 'todos', count: 2 } })]}
      />
    )
    expect(
      screen.getByText('sessions.timeline.summary.todos {"count":2}')
    ).toBeInTheDocument()
  })

  it('renders the grep-in summary with pattern and path values', () => {
    render(
      <Timeline
        items={[
          item({
            summary: '',
            summaryMsg: { kind: 'grepIn', pattern: 'foo', path: 'src' },
          }),
        ]}
      />
    )
    expect(
      screen.getByText(
        'sessions.timeline.summary.grepIn {"pattern":"foo","path":"src"}'
      )
    ).toBeInTheDocument()
  })

  it('renders a block text key through intl (interrupted status)', () => {
    render(
      <Timeline
        items={[
          item({
            details: [
              {
                labelKey: 'status',
                variant: 'error',
                text: '',
                textKey: 'interrupted',
              },
            ],
          }),
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(
      screen.getByText('sessions.timeline.badge.interrupted {}')
    ).toBeInTheDocument()
  })
})
