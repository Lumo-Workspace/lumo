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

test('renders actions slot', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>} actions={<span>ACT</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('ACT')).toBeTruthy()
})
