/** @jest-environment jsdom */

// Isolate DetailLayout from PageBreadcrumb's heavy deps (sidebar/separator UI).
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({
    children,
    actions,
  }: {
    children?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div>
      <div data-testid='bc'>{children}</div>
      {actions ? <div data-testid='actions'>{actions}</div> : null}
    </div>
  ),
}))

import { render, screen } from '@testing-library/react'
import { DetailLayout } from '@/app/workspace/[workspaceUrl]/components/DetailLayout'

test('renders breadcrumb, body and sidebar', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>} sidebar={<span>SIDE</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('BC')).toBeTruthy()
  expect(screen.getByText('BODY')).toBeTruthy()
  expect(screen.getByText('SIDE')).toBeTruthy()
})

test('hides sidebar when collapsed', () => {
  render(
    <DetailLayout
      breadcrumb={<span>BC</span>}
      sidebar={<span>SIDE</span>}
      sidebarCollapsed
    >
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('BODY')).toBeTruthy()
  expect(screen.queryByText('SIDE')).toBeNull()
})

test('hides sidebar when none provided', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.queryByText('SIDE')).toBeNull()
})

test('default sidebar layout keeps the inter-column gap + right padding', () => {
  const { container } = render(
    <DetailLayout breadcrumb={<span>BC</span>} sidebar={<span>SIDE</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  const body = container.querySelector('div.lg\\:grid')!
  expect(body.className).toContain('lg:gap-4')
  expect(body.className).toContain('lg:pr-4')
})

test('flushSidebar drops the gap + padding and fills the rail height', () => {
  const { container } = render(
    <DetailLayout
      breadcrumb={<span>BC</span>}
      sidebar={<span>SIDE</span>}
      flushSidebar
    >
      <span>BODY</span>
    </DetailLayout>
  )
  const body = container.querySelector('div.lg\\:grid')!
  expect(body.className).not.toContain('lg:gap-4')
  expect(body.className).not.toContain('lg:pr-4')
  expect(container.querySelector('aside')!.className).toContain('lg:h-full')
})

test('renders actions slot', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>} actions={<span>ACT</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('ACT')).toBeTruthy()
})
