/** @jest-environment jsdom */
/**
 * LUM-1114 — the settings card listing rules nothing checks automatically.
 * A failed load must never read as "all checked".
 */
import { render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const en = jest.requireActual('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, number>
      ) =>
        (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k: string) =>
          String(values?.[k] ?? `{${k}}`)
        ),
    }),
  }
})
jest.mock('@/ee/security/hooks/usePolicyCoverage', () => ({
  usePolicyCoverage: jest.fn(),
}))

import { PolicyCoverageCard } from '@/ee/security/components/settings/PolicyCoverageCard'
import { usePolicyCoverage } from '@/ee/security/hooks/usePolicyCoverage'

const hook = usePolicyCoverage as jest.Mock

describe('PolicyCoverageCard', () => {
  it('lists each unchecked rule with its reason, per project', () => {
    hook.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        projects: [
          {
            projectId: 'p1',
            projectName: 'Lumo',
            compiledAt: '2026-10-11T13:23:16.000Z',
            totalRules: 47,
            unchecked: [
              {
                ruleId: 'a',
                text: 'Branch naming: lumo/{task-id}-{slug}',
                kind: 'action',
                reason: 'NO_CHECKER',
              },
              {
                ruleId: 'b',
                text: 'No raw SQL',
                kind: 'code',
                reason: 'AI_REVIEW_OFF',
              },
            ],
          },
          {
            projectId: 'p2',
            projectName: 'Growth',
            compiledAt: null,
            totalRules: 0,
            unchecked: [],
          },
          {
            projectId: 'p3',
            projectName: 'Docs',
            compiledAt: '2026-10-01T00:00:00.000Z',
            totalRules: 5,
            unchecked: [],
          },
        ],
      },
    })
    render(<PolicyCoverageCard />)
    expect(screen.getByText('Rules not checked automatically')).toBeTruthy()
    expect(
      screen.getByText('2 of 47 rules are not checked automatically.')
    ).toBeTruthy()
    expect(
      screen.getByText('Branch naming: lumo/{task-id}-{slug}')
    ).toBeTruthy()
    expect(
      screen.getByText(/No automatic check exists for this kind of rule yet/)
    ).toBeTruthy()
    expect(screen.getByText(/AI review is turned off above/)).toBeTruthy()
    expect(screen.getByText(/No rules read yet/)).toBeTruthy()
    expect(
      screen.getByText('All 5 rules are checked automatically.')
    ).toBeTruthy()
  })

  it('a failed load says it could not tell — never "all checked"', () => {
    hook.mockReturnValue({ isLoading: false, isError: true, data: undefined })
    render(<PolicyCoverageCard />)
    expect(screen.getByText(/Couldn't load rule coverage/)).toBeTruthy()
    expect(screen.queryByText(/checked automatically\./)).toBeNull()
  })

  it('shows a loading line while fetching', () => {
    hook.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    render(<PolicyCoverageCard />)
    expect(screen.getByText('Checking rule coverage…')).toBeTruthy()
  })
})
