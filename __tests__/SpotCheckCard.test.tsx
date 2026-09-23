/**
 * @jest-environment jsdom
 *
 * LUM-819 返工：Dashboard 上的抽查入口。读数带样本量，点按钮进抽查页。
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        let raw = messages[id] ?? id
        for (const [k, v] of Object.entries(values ?? {}))
          raw = raw.split(`{${k}}`).join(String(v))
        return raw
      },
      formatNumber: (n: number) => `${Math.round(n * 100)}%`,
    }),
  }
})

import { SpotCheckCard } from '@/app/workspace/[workspaceUrl]/components/summary/SpotCheckCard'

describe('SpotCheckCard', () => {
  it('shows the rate with its sample size and opens the review page', () => {
    const onOpen = jest.fn()
    render(
      <SpotCheckCard
        rate={{ status: 'measured', reviewed: 20, rejected: 3, rate: 0.15 }}
        poolSize={37}
        onOpen={onOpen}
      />
    )
    expect(
      screen.getByText(
        '3 of 20 reviewed passes sent back — 15% false-report rate'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '37 reported passes with evidence are waiting for a spot-check'
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Spot-check a sample' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
