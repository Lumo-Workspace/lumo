/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { IntegrationCard } from '@/app/workspace/[workspaceUrl]/components/IntegrationCard'

describe('IntegrationCard', () => {
  it('renders title, description and header action', () => {
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Google Drive'
        description='将 Google 文档导入为 Lumo 文档。通过 Google Drive OAuth 进行单向同步。'
        headerAction={<span>已连接</span>}
      />
    )
    expect(screen.getByText('Google Drive')).toBeInTheDocument()
    expect(screen.getByText('已连接')).toBeInTheDocument()
  })

  it('keeps the header action from being squeezed by a long description', () => {
    // Regression: a long description used to push the status badge so it
    // wrapped onto two lines. The badge must stay on a single line.
    render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Google Drive'
        description='将 Google 文档导入为 Lumo 文档。通过 Google Drive OAuth 进行单向同步。'
        headerAction={<span>已连接</span>}
      />
    )
    const actionWrapper = screen.getByText('已连接').parentElement
    expect(actionWrapper).toHaveClass('shrink-0')
    expect(actionWrapper).toHaveClass('whitespace-nowrap')
  })

  it('allows the text column to shrink so the badge wins the space contest', () => {
    const { container } = render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Google Drive'
        description='将 Google 文档导入为 Lumo 文档。通过 Google Drive OAuth 进行单向同步。'
        headerAction={<span>已连接</span>}
      />
    )
    // The flexible left column and its text block must both allow shrinking.
    const shrinkable = container.querySelectorAll('.min-w-0')
    expect(shrinkable.length).toBeGreaterThanOrEqual(2)
  })

  it('does not render an empty action wrapper when no header action is given', () => {
    const { container } = render(
      <IntegrationCard
        icon={<span>icon</span>}
        title='Sentry'
        description='自动从 Sentry 告警创建任务。'
      />
    )
    expect(container.querySelector('.shrink-0.whitespace-nowrap')).toBeNull()
  })
})
