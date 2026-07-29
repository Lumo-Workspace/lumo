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
  /**
   * Flush the sidebar against the right edge (no inter-column gap / right
   * padding) so a panel with its own `border-l` reads as a continuous rail —
   * matching the task detail sidebar. Default keeps the floating-gap layout.
   */
  flushSidebar?: boolean
  /**
   * Let the single-column body scroll vertically instead of pinning it to the
   * viewport. Use it when content *above* the main pane can grow unbounded —
   * without it `overflow-hidden` clips that content and everything below it
   * becomes unreachable. Ignored when a sidebar shows (the two-column body
   * already scrolls its columns), which is why a page whose growing content
   * lives in the rail doesn't need it.
   */
  scrollBody?: boolean
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
  flushSidebar = false,
  scrollBody = false,
  children,
}: DetailLayoutProps) {
  const showSidebar = sidebar != null && !sidebarCollapsed
  // Flush variant drops the inter-column gap + right padding so a bordered
  // panel sits edge-to-edge; the panel's own border is the column divider.
  //
  // `flex flex-col` (no-sidebar) and `lg:grid-rows-1` (two-column) are what
  // give the content column a *bounded* height: without them the single
  // grid/flow row is `auto`-sized to its content, so a tall child (e.g. the
  // kanban BoardView) overflows and is clipped by `overflow-hidden` instead
  // of scrolling internally. `grid-rows-1` == `grid-template-rows:
  // minmax(0,1fr)`, pinning the row to the container height so each column
  // scrolls on its own — matching the project task board.
  const bodyClass = !showSidebar
    ? scrollBody
      ? 'flex-1 min-h-0 flex flex-col overflow-y-auto'
      : 'flex-1 min-h-0 flex flex-col overflow-hidden'
    : flushSidebar
      ? 'flex-1 min-h-0 flex flex-col overflow-y-auto lg:grid lg:grid-cols-[1fr_320px] lg:grid-rows-1 lg:overflow-hidden'
      : 'flex-1 min-h-0 flex flex-col overflow-y-auto lg:grid lg:grid-cols-[1fr_320px] lg:grid-rows-1 lg:gap-4 lg:pr-4 lg:overflow-hidden'
  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb actions={actions}>{breadcrumb}</PageBreadcrumb>
      <div className={bodyClass}>
        {children}
        {showSidebar ? (
          <aside
            className={
              flushSidebar
                ? 'lg:h-full lg:overflow-y-auto'
                : 'lg:overflow-y-auto'
            }
          >
            {sidebar}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
