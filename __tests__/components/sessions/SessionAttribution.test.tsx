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

import { render, screen } from '@testing-library/react'
import { SessionAttribution } from '@/app/sessions/[id]/SessionAttribution'
import type { SessionAttributionView } from '@/lib/services/session-list.service'

const view = (
  over: Partial<SessionAttributionView> = {}
): SessionAttributionView => ({
  segments: [],
  subagents: [],
  unattributed: false,
  approximate: false,
  ...over,
})

describe('SessionAttribution', () => {
  it('renders segments with task, source, confidence and evidence', () => {
    render(
      <SessionAttribution
        view={view({
          segments: [
            {
              taskIdentifier: 'LUM-12',
              source: 'INFERRED',
              confidence: 'HIGH',
              fromTurn: 0,
              toTurn: 1,
              evidence: [
                {
                  kind: 'BRANCH',
                  identifier: 'LUM-12',
                  at: '2026-06-07T10:00:00Z',
                },
              ],
            },
          ],
          approximate: true,
        })}
      />
    )
    expect(screen.getAllByText(/LUM-12/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/Auto-detected from signals/)).toBeInTheDocument()
    expect(screen.getByText(/High confidence/)).toBeInTheDocument()
    expect(screen.getByText(/Branch name/)).toBeInTheDocument()
  })

  it('renders subagent rows with agent type and tasks', () => {
    render(
      <SessionAttribution
        view={view({
          subagents: [
            {
              sessionId: 'c1',
              agentType: 'Explore',
              tasks: [
                {
                  taskIdentifier: 'LUM-9',
                  source: 'SUBAGENT_ATTACH',
                  confidence: 'EXPLICIT',
                },
              ],
            },
            { sessionId: 'c2', agentType: 'Plan', tasks: [] },
          ],
        })}
      />
    )
    expect(screen.getByText(/Explore/)).toBeInTheDocument()
    expect(screen.getByText(/LUM-9/)).toBeInTheDocument()
    expect(screen.getByText(/Plan/)).toBeInTheDocument()
    expect(screen.getByText(/follows parent/)).toBeInTheDocument()
  })

  it('renders the unattributed note', () => {
    render(<SessionAttribution view={view({ unattributed: true })} />)
    expect(screen.getByText(/Unattributed/)).toBeInTheDocument()
  })

  it('renders the approximate notice only when approximate', () => {
    const { rerender } = render(
      <SessionAttribution view={view({ approximate: true })} />
    )
    expect(
      screen.getByText(/Measurement may be inaccurate/)
    ).toBeInTheDocument()
    rerender(<SessionAttribution view={view()} />)
    expect(screen.queryByText(/Measurement may be inaccurate/)).toBeNull()
  })
})
