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

test('two-column body pins the grid row height so each column scrolls internally', () => {
  // `lg:grid-rows-1` bounds the single grid row to the container height —
  // without it a tall content column (the kanban board) overflows and is
  // clipped instead of scrolling. Both grid variants must carry it.
  for (const flush of [false, true]) {
    const { container, unmount } = render(
      <DetailLayout
        breadcrumb={<span>BC</span>}
        sidebar={<span>SIDE</span>}
        {...(flush ? { flushSidebar: true } : {})}
      >
        <span>BODY</span>
      </DetailLayout>
    )
    const body = container.querySelector('div.lg\\:grid')!
    expect(body.className).toContain('lg:grid-rows-1')
    unmount()
  }
})

test('no-sidebar body is a flex column so the content fills/scrolls', () => {
  // When the sidebar is collapsed the body must be a flex column, otherwise
  // the single child's `flex-1` is inert and the board height is unbounded.
  const { container } = render(
    <DetailLayout
      breadcrumb={<span>BC</span>}
      sidebar={<span>SIDE</span>}
      sidebarCollapsed
    >
      <span>BODY</span>
    </DetailLayout>
  )
  const body = container.querySelector('div.flex-1.min-h-0')!
  expect(body.className).toContain('flex')
  expect(body.className).toContain('flex-col')
  expect(body.className).toContain('overflow-hidden')
})

test('scrollBody swaps the no-sidebar clip for a vertical scroller', () => {
  // Opt-in for pages whose content *above* the main pane grows unbounded (the
  // sprint detail info block): `overflow-hidden` would clip it with no way to
  // reach what fell past the fold.
  const { container } = render(
    <DetailLayout breadcrumb={<span>BC</span>} scrollBody>
      <span>BODY</span>
    </DetailLayout>
  )
  const body = container.querySelector('div.flex-1.min-h-0')!
  expect(body.className).toContain('overflow-y-auto')
  expect(body.className).not.toContain('overflow-hidden')
})

test('renders actions slot', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>} actions={<span>ACT</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('ACT')).toBeTruthy()
})
