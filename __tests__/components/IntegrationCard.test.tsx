import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationCard } from '@/app/workspace/[workspaceUrl]/components/IntegrationCard'

describe('IntegrationCard', () => {
  it('hides collapsible body until the chevron toggle is clicked', () => {
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='GitHub'
        description='desc'
        collapsible
      >
        <p>connected body</p>
      </IntegrationCard>
    )

    // Body starts collapsed.
    expect(screen.queryByText('connected body')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { expanded: false })
    fireEvent.click(toggle)

    // Body appears after expanding.
    expect(screen.getByText('connected body')).toBeInTheDocument()
  })

  it('calls onDisconnect when the X button is clicked', () => {
    const onDisconnect = jest.fn()
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='GitHub'
        description='desc'
        onDisconnect={onDisconnect}
        disconnectLabel='Disconnect'
      >
        <p>connected body</p>
      </IntegrationCard>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('renders the body without collapse when not collapsible', () => {
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='GitHub'
        description='desc'
      >
        <p>always visible</p>
      </IntegrationCard>
    )
    expect(screen.getByText('always visible')).toBeInTheDocument()
  })
})
