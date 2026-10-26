// Mock react-intl: echo interpolated defaultMessage (same recipe as LineageTab.test).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values)
        for (const [k, v] of Object.entries(values))
          s = s.split(`{${k}}`).join(String(v))
      return s
    },
    formatNumber: (n: number) => n.toLocaleString('en-US'),
  }),
}))

// Mock InfoTooltip to a plain element exposing the label (avoids Radix portal in jsdom).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/InfoTooltip',
  () => ({
    InfoTooltip: ({ label }: { label: string }) => (
      <span data-testid='info' aria-label={label} />
    ),
  })
)

import { render, screen } from '@testing-library/react'
import { DisclosureFunnel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/DisclosureFunnel'

const FUNNEL = {
  impressions: 580,
  index: 277,
  pulled: 0,
  used: 14,
  voted: 20,
  tokensSaved: 1200000,
}

describe('DisclosureFunnel', () => {
  it('renders the four funnel rows with CLI-aligned percentages', () => {
    render(<DisclosureFunnel funnel={FUNNEL} />)
    expect(screen.getByText('580')).toBeInTheDocument()
    expect(screen.getByText('277')).toBeInTheDocument()
    expect(screen.getByText('48%')).toBeInTheDocument()
    expect(screen.getByText('占索引 0%')).toBeInTheDocument()
    expect(screen.getByText('2%')).toBeInTheDocument()
  })

  it('shows the tokens-saved chip when tokensSaved is set', () => {
    render(<DisclosureFunnel funnel={FUNNEL} />)
    expect(screen.getByText('~1,200,000 tokens 省下')).toBeInTheDocument()
  })

  it('omits the tokens-saved chip when tokensSaved is null', () => {
    render(<DisclosureFunnel funnel={{ ...FUNNEL, tokensSaved: null }} />)
    expect(screen.queryByText(/tokens 省下/)).not.toBeInTheDocument()
  })

  it('renders nothing when there are no impressions', () => {
    const { container } = render(
      <DisclosureFunnel
        funnel={{
          impressions: 0,
          index: 0,
          pulled: 0,
          used: 0,
          voted: 0,
          tokensSaved: null,
        }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows "not reported" instead of 0% when no agent voted (LUM-1294)', () => {
    render(<DisclosureFunnel funnel={{ ...FUNNEL, used: 0, voted: 0 }} />)
    expect(screen.getByText('— not reported')).toBeInTheDocument()
    expect(screen.queryByText('0%')).toBeNull()
  })
})
