/** @jest-environment jsdom */
jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, unknown>
      ) => {
        const template = en[id] ?? defaultMessage ?? id
        if (!values) return template
        return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_, key) =>
          values[key] != null ? String(values[key]) : _
        )
      },
    }),
  }
})

import { render, screen } from '@testing-library/react'
import { DeliveryKpis } from '@/app/workspace/[workspaceUrl]/components/DeliveryKpis'
import type { BaselineStat } from '@/lib/baseline/types'

const withBase: BaselineStat = {
  current: 6,
  base: 4,
  spread: { p25: 3, p75: 5 },
  sampleSize: 5,
  band: 'above',
  deltaPct: 50,
  deltaKind: 'magnitude',
}
const noBase: BaselineStat = {
  current: 120,
  base: null,
  spread: null,
  sampleSize: 0,
  band: null,
  deltaPct: null,
  deltaKind: 'magnitude',
}

it('renders runs baseline (current + median + pill) and duration without baseline', () => {
  render(
    <DeliveryKpis
      runs={withBase}
      interactionRounds={withBase}
      duration={noBase}
    />
  )
  expect(screen.getAllByText('6').length).toBeGreaterThan(0)
  expect(screen.getAllByText(/\+50%/).length).toBeGreaterThan(0)
  expect(screen.getByText('No baseline yet')).toBeInTheDocument()
})
