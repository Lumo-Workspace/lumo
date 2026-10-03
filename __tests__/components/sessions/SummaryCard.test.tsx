/** @jest-environment jsdom */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        s = s.replace(
          /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
          (_: string, key: string, one: string, other: string) => {
            const n = Number(values[key] ?? 0)
            return (n === 1 ? one : other).replace('#', String(n))
          }
        )
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
  }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}))
jest.mock('@/lib/api-client', () => ({
  sessionsClient: { summarize: jest.fn() },
  ApiClientError: class extends Error {},
}))
jest.mock('@/hooks/use-now', () => ({ useNow: () => null }))

import { render, screen } from '@testing-library/react'
import { SummaryCard } from '@/app/sessions/[id]/SummaryCard'

const base = {
  sessionId: 's1',
  initialSummary: null,
  initialSummaryType: null,
  initialGeneratedAt: null,
  initialEventCount: null,
  currentEventCount: 3,
  isStale: false,
}

describe('SummaryCard', () => {
  it('renders the localized empty copy and generate button', () => {
    render(<SummaryCard {...base} />)
    expect(screen.getByText(/No summary yet/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generate summary' })
    ).toBeInTheDocument()
  })

  it('renders localized section titles for a typed summary', () => {
    render(
      <SummaryCard
        {...base}
        initialSummaryType='mixed'
        initialSummary={{
          type: 'mixed',
          overview: 'did stuff',
          mainActivities: ['a'],
          unresolved: [],
        }}
      />
    )
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Main activities')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Regenerate' })
    ).toBeInTheDocument()
  })
})
