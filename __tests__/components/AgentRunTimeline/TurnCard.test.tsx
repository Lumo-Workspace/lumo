/** @jest-environment jsdom */

// Same react-intl mock shape as the sibling suites: interpolated
// defaultMessage, formatNumber = String(n).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

import { render, screen } from '@testing-library/react'
import { TurnCard } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/TurnCard'
import type { Turn } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns'
import type { ModelCost } from '@/app/workspace/[workspaceUrl]/types'

const opus: ModelCost = {
  model: 'claude-opus-4-8',
  input: 95,
  output: 180,
  cacheRead: 10_900_000,
  cacheCreation: 1_200_000,
  total: 12_300_000,
}
const sentinel: ModelCost = {
  model: '__in_flight__',
  input: 10,
  output: 5,
  cacheRead: 80,
  cacheCreation: 5,
  total: 100,
}

function turnWith(byModel: ModelCost[]): Turn {
  return {
    startTime: '2026-06-09T10:00:00.000Z',
    endTime: '2026-06-09T10:05:00.000Z',
    events: [],
    memories: [],
    terminated: true,
    summary: null,
    cost: { byModel },
  } as unknown as Turn
}

describe('TurnCard cost formatting', () => {
  it('renders the in-flight sentinel as "in progress", never the raw key (multi-model)', () => {
    render(<TurnCard turn={turnWith([opus, sentinel])} turnNumber={1} />)
    expect(screen.getByText(/in progress 100/)).toBeInTheDocument()
    expect(screen.queryByText(/__in_flight__/)).not.toBeInTheDocument()
  })

  it('renders the in-flight sentinel sublabel as "in progress" when it is the only row', () => {
    render(<TurnCard turn={turnWith([sentinel])} turnNumber={1} />)
    expect(screen.getByText('in progress')).toBeInTheDocument()
    expect(screen.queryByText(/__in_flight__/)).not.toBeInTheDocument()
  })

  it('keeps real model names byte-identical to the old inline formatting', () => {
    render(
      <TurnCard
        turn={turnWith([opus, { ...opus, model: 'claude-sonnet-4-6', total: 3_300_000 }])}
        turnNumber={1}
      />
    )
    expect(
      screen.getByText('opus-4-8 12300000 · sonnet-4-6 3300000')
    ).toBeInTheDocument()
  })
})
