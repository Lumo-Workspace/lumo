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
    render(<TopOperations operations={OPS} taskIdentifier='LUM-531' />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('184,200')).toBeInTheDocument()
    expect(screen.getByText('12,300')).toBeInTheDocument()
    expect(screen.getByText('4,500')).toBeInTheDocument()
    expect(screen.getByText('2,940,100')).toBeInTheDocument()
    expect(screen.getByText('3,141,100')).toBeInTheDocument()
  })

  it('points the footnote at lumo cost --task <id>', () => {
    render(<TopOperations operations={OPS} taskIdentifier='LUM-531' />)
    expect(screen.getByText(/lumo cost --task LUM-531/)).toBeInTheDocument()
  })

  it('renders nothing when there are no operations', () => {
    const { container } = render(
      <TopOperations operations={[]} taskIdentifier='LUM-531' />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
