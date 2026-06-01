/** @jest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationCard } from '@/app/workspace/[workspaceUrl]/components/IntegrationCard'

describe('IntegrationCard', () => {
  it('renders title, description and header action', () => {
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Google Drive'
        description='将 Google 文档导入为 Lumo 文档。通过 Google Drive OAuth 进行单向同步。'
        headerAction={<span>已连接</span>}
      />,
    )
    expect(screen.getByText('Google Drive')).toBeInTheDocument()
    expect(screen.getByText('已连接')).toBeInTheDocument()
  })

  it('keeps the header action from being squeezed by a long description', () => {
    // Regression: a long description used to push the status badge so it
    // wrapped onto two lines. The action cluster must stay on a single line.
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Google Drive'
        description='将 Google 文档导入为 Lumo 文档。通过 Google Drive OAuth 进行单向同步。'
        headerAction={<span>已连接</span>}
      />,
    )
    const actionCluster = screen.getByText('已连接').parentElement
    expect(actionCluster).toHaveClass('shrink-0')
    expect(actionCluster).toHaveClass('whitespace-nowrap')
  })

  it('allows the text column to shrink so the badge wins the space contest', () => {
    const { container } = render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Google Drive'
        description='将 Google 文档导入为 Lumo 文档。通过 Google Drive OAuth 进行单向同步。'
        headerAction={<span>已连接</span>}
      />,
    )
    // The flexible left column and its text block must both allow shrinking.
    const shrinkable = container.querySelectorAll('.min-w-0')
    expect(shrinkable.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the nowrap guard even alongside collapse and disconnect controls', () => {
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Google Drive'
        description='将 Google 文档导入为 Lumo 文档。通过 Google Drive OAuth 进行单向同步。'
        headerAction={<span>已连接</span>}
        collapsible
        onDisconnect={() => {}}
        disconnectLabel='Disconnect'
      >
        <p>connected body</p>
      </IntegrationCard>,
    )
    const actionCluster = screen.getByText('已连接').parentElement
    expect(actionCluster).toHaveClass('shrink-0')
    expect(actionCluster).toHaveClass('whitespace-nowrap')
  })

  it('hides collapsible body until the chevron toggle is clicked', () => {
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='GitHub'
        description='desc'
        collapsible
      >
        <p>connected body</p>
      </IntegrationCard>,
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
      </IntegrationCard>,
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
      </IntegrationCard>,
    )
    expect(screen.getByText('always visible')).toBeInTheDocument()
  })
})
