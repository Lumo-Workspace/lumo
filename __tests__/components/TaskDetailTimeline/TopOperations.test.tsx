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

import { render, screen } from '@testing-library/react'
import { TopOperations } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TopOperations'

const OPS = [
  { tool: 'Bash', output: 184200, input: 12300, cacheCreation: 4500, cacheRead: 2940100, total: 3141100 }, // prettier-ignore
  { tool: 'Read', output: 96500, input: 7600, cacheCreation: 2100, cacheRead: 1810400, total: 1916600 }, // prettier-ignore
]

describe('TopOperations', () => {
  it('renders each tool row with output / input / cache-create / cache-read / total', () => {
    render(
      <TopOperations
        operations={OPS}
        precision={null}
        taskIdentifier='LUM-531'
      />
    )
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('184,200')).toBeInTheDocument()
    expect(screen.getByText('12,300')).toBeInTheDocument()
    expect(screen.getByText('4,500')).toBeInTheDocument()
    expect(screen.getByText('2,940,100')).toBeInTheDocument()
    expect(screen.getByText('3,141,100')).toBeInTheDocument()
  })

  it('points the footnote at lumo cost --task <id>', () => {
    render(
      <TopOperations
        operations={OPS}
        precision={null}
        taskIdentifier='LUM-531'
      />
    )
    expect(screen.getByText(/lumo cost --task LUM-531/)).toBeInTheDocument()
  })

  it('renders nothing when there are no operations', () => {
    const { container } = render(
      <TopOperations
        operations={[]}
        precision={null}
        taskIdentifier='LUM-531'
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('collapses to a total line when every token fell to thinking (LUM-1294)', () => {
    const thinking = [{ tool: '(thinking / no tool)', output: 30184, input: 82, cacheCreation: 168959, cacheRead: 5405022, total: 5604247 }] // prettier-ignore
    render(
      <TopOperations
        operations={thinking}
        precision={{ perStepPct: 0, cacheReadPct: 0.96, hasToolRows: false }}
        taskIdentifier='LUM-1277'
      />
    )
    expect(screen.getByText(/5,604,247 tokens in total/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('notes a per-turn estimate and a cache-read-dominated total (LUM-1294)', () => {
    render(
      <TopOperations
        operations={OPS}
        precision={{ perStepPct: 0.25, cacheReadPct: 0.94, hasToolRows: true }}
        taskIdentifier='LUM-531'
      />
    )
    expect(screen.getByText(/Estimated per turn: 25%/)).toBeInTheDocument()
    expect(
      screen.getByText(/94% of these tokens are cache reads/)
    ).toBeInTheDocument()
  })

  it('says measured per step and skips the cache note below the threshold', () => {
    render(
      <TopOperations
        operations={OPS}
        precision={{ perStepPct: 1, cacheReadPct: 0.5, hasToolRows: true }}
        taskIdentifier='LUM-531'
      />
    )
    expect(screen.getByText('Measured per step.')).toBeInTheDocument()
    expect(screen.queryByText(/cache reads/)).toBeNull()
  })
})
