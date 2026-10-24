import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { LINE, ROW_WIDTHS, SkeletonLine, rowDelay } from './SkeletonLine'

interface RowListSkeletonProps {
  /** Number of placeholder rows. */
  rows?: number
  /** Leading glyph: a round avatar, a square icon, or nothing. */
  leading?: 'avatar' | 'icon' | 'none'
  /** Add a caption line under the title, for two-line rows. */
  subtitle?: boolean
  /** Add a short meta bar at the end of the row (date, count, badge). */
  trailing?: boolean
  /** Separate rows with a border instead of a gap. */
  divided?: boolean
  /** Row padding; match the real row's so heights line up. */
  rowClassName?: string
  className?: string
}

/**
 * The default loading placeholder: a stack of list rows. Most loading
 * regions in the app are lists (members, tags, keys, links, decisions…), so
 * one configurable row covers them; pages with a distinctive layout pass
 * their own skeleton to `AsyncContent`'s `loadingState` instead.
 */
export function RowListSkeleton({
  rows = 3,
  leading = 'none',
  subtitle = false,
  trailing = true,
  divided = false,
  rowClassName = 'py-2',
  className,
}: RowListSkeletonProps) {
  return (
    <div
      aria-hidden
      data-testid='row-list-skeleton'
      className={cn(
        divided ? 'divide-y divide-border' : 'space-y-1',
        className
      )}
    >
      {Array.from({ length: rows }, (_, i) => {
        const delay = rowDelay(i)
        return (
          <div key={i} className={cn('flex items-center gap-3', rowClassName)}>
            {leading !== 'none' && (
              <Skeleton
                className={cn(
                  'size-6 shrink-0',
                  leading === 'avatar' ? 'rounded-full' : 'rounded-md'
                )}
                style={{ animationDelay: `${delay}ms` }}
              />
            )}
            <div className='min-w-0 flex-1'>
              <SkeletonLine
                boxHeight={LINE.body}
                width={ROW_WIDTHS[i % ROW_WIDTHS.length]!}
                delay={delay}
              />
              {subtitle && (
                <SkeletonLine
                  boxHeight={LINE.caption}
                  barHeight='h-2'
                  width='32%'
                  delay={delay + 100}
                />
              )}
            </div>
            {trailing && (
              <Skeleton
                className='h-2.5 w-14 shrink-0 rounded-full'
                style={{ animationDelay: `${delay + 100}ms` }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
