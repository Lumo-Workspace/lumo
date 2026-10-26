import { Skeleton } from '@/components/ui/skeleton'
import { LINE, ROW_WIDTHS, SkeletonLine, rowDelay } from './SkeletonLine'

/** DataTable's fixed row height (data-table.tsx ROW_HEIGHT). */
const ROW_HEIGHT = 49

/**
 * The task table while it loads: DataTable's sticky header strip, then rows
 * at its fixed 49px height — checkbox, identifier, title, and the status /
 * assignee / date cells on the right — so the table does not jump when the
 * tasks land.
 */
export function TaskTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden data-testid='task-table-skeleton' className='text-body'>
      <div className='flex items-center gap-4 border-b border-border px-4 py-2.5'>
        <SkeletonLine boxHeight={LINE.caption} barHeight='h-2' width='64px' />
        <div className='flex-1' />
        <SkeletonLine boxHeight={LINE.caption} barHeight='h-2' width='48px' />
        <SkeletonLine boxHeight={LINE.caption} barHeight='h-2' width='56px' />
      </div>
      {Array.from({ length: rows }, (_, i) => {
        const delay = rowDelay(i)
        return (
          <div
            key={i}
            className='flex items-center gap-4 border-b border-border px-4'
            style={{ height: ROW_HEIGHT }}
          >
            <Skeleton
              className='size-4 shrink-0 rounded-sm'
              style={{ animationDelay: `${delay}ms` }}
            />
            <Skeleton
              className='h-2.5 w-14 shrink-0 rounded-full'
              style={{ animationDelay: `${delay}ms` }}
            />
            <div className='min-w-0 flex-1'>
              <SkeletonLine
                boxHeight={LINE.body}
                width={ROW_WIDTHS[i % ROW_WIDTHS.length]!}
                delay={delay}
              />
            </div>
            <Skeleton
              className='hidden h-5 w-20 shrink-0 rounded-full sm:block'
              style={{ animationDelay: `${delay + 100}ms` }}
            />
            <Skeleton
              className='size-5 shrink-0 rounded-full'
              style={{ animationDelay: `${delay + 100}ms` }}
            />
            <Skeleton
              className='hidden h-2.5 w-12 shrink-0 rounded-full sm:block'
              style={{ animationDelay: `${delay + 200}ms` }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Cards per column — uneven, like a real board. */
const BOARD_COLUMNS = [3, 2, 4, 1]

/**
 * The board while it loads: BoardView's tinted canvas with its 320px
 * columns, each a header (label + count) over SortableTaskCard-shaped cards
 * (identifier row, title, footer).
 */
export function TaskBoardSkeleton() {
  return (
    <div
      aria-hidden
      data-testid='task-board-skeleton'
      className='flex flex-1 gap-3 overflow-x-hidden border-t border-border bg-muted/50 p-8'
    >
      {BOARD_COLUMNS.map((cards, c) => (
        <div key={c} className='flex w-80 min-w-[320px] flex-col'>
          <div className='mb-3 flex items-center gap-2 px-1'>
            <Skeleton className='size-3.5 rounded-full' />
            <SkeletonLine
              boxHeight={LINE.caption}
              barHeight='h-2'
              width='72px'
            />
          </div>
          <div className='space-y-3'>
            {Array.from({ length: cards }, (_, i) => {
              const delay = rowDelay(c + i)
              return (
                <div
                  key={i}
                  className='rounded-lg border border-border bg-card p-3'
                >
                  <SkeletonLine
                    boxHeight={LINE.caption}
                    barHeight='h-2'
                    width='56px'
                    delay={delay}
                    className='mb-2'
                  />
                  <SkeletonLine
                    boxHeight={LINE.body}
                    width={ROW_WIDTHS[(c + i) % ROW_WIDTHS.length]!}
                    delay={delay + 100}
                    className='mb-4'
                  />
                  <div className='flex items-center justify-between'>
                    <Skeleton
                      className='size-5 rounded-full'
                      style={{ animationDelay: `${delay + 200}ms` }}
                    />
                    <Skeleton
                      className='h-2.5 w-12 rounded-full'
                      style={{ animationDelay: `${delay + 200}ms` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
