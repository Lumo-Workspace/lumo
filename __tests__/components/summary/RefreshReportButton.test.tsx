jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      const messages: Record<string, string> = {
        'summary.refreshReport': 'Refresh report',
        'summary.generating': 'Generating…',
        'summary.cooldown': 'Retry in {seconds}s',
      }
      const raw = messages[id] ?? id
      if (!values) return raw
      return raw.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { RefreshReportButton } from '@/app/workspace/[workspaceUrl]/components/summary/RefreshReportButton'

describe('RefreshReportButton', () => {
  it('renders idle state with refresh label', () => {
    render(
      <RefreshReportButton
        state='idle'
        cooldownSeconds={0}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByRole('button')).toHaveTextContent('Refresh report')
    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('renders generating state with spinner', () => {
    render(
      <RefreshReportButton
        state='generating'
        cooldownSeconds={0}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByRole('button')).toHaveTextContent('Generating…')
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('renders cooldown state with countdown', () => {
    render(
      <RefreshReportButton
        state='cooldown'
        cooldownSeconds={120}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByRole('button')).toHaveTextContent('Retry in 120s')
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('calls onRefresh when clicked in idle state', () => {
    const onRefresh = jest.fn()
    render(
      <RefreshReportButton
        state='idle'
        cooldownSeconds={0}
        onRefresh={onRefresh}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
