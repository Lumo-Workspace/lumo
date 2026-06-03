import type { ReactNode } from 'react'
import { PageBreadcrumb } from './PageBreadcrumb'

interface DetailLayoutProps {
  /** Breadcrumb content (multi-level allowed). */
  breadcrumb: ReactNode
  /** Right-aligned actions in the breadcrumb bar. */
  actions?: ReactNode
  /** Right-hand properties panel. Omit for a single-column body. */
  sidebar?: ReactNode
  /** When true, hide the sidebar (collapse is owned by the page). */
  sidebarCollapsed?: boolean
  /** Main content area. */
  children: ReactNode
}

/**
 * Shared three-part detail layout: breadcrumb on top, main content in the
 * center, an optional properties panel on the right. Pure presentation — the
 * page owns data fetching and collapse state.
 *
 * Responsive: on `lg` and up it is a two-column grid (content + 320px rail)
 * with each column scrolling internally; below `lg` it stacks vertically
 * (rail below content) and the whole body scrolls. No horizontal scroll.
 */
export function DetailLayout({
  breadcrumb,
  actions,
  sidebar,
  sidebarCollapsed = false,
  children,
}: DetailLayoutProps) {
  const showSidebar = sidebar != null && !sidebarCollapsed
  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb actions={actions}>{breadcrumb}</PageBreadcrumb>
      <div
        className={
          showSidebar
            ? 'flex-1 min-h-0 flex flex-col overflow-y-auto lg:grid lg:grid-cols-[1fr_320px] lg:gap-4 lg:pr-4 lg:overflow-hidden'
            : 'flex-1 min-h-0 overflow-hidden'
        }
      >
        {children}
        {showSidebar ? (
          <aside className='lg:overflow-y-auto'>{sidebar}</aside>
        ) : null}
      </div>
    </div>
  )
}
