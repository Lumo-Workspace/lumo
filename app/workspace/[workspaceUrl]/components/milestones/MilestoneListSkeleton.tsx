import { Skeleton } from '@/components/ui/skeleton'

/** Title-bar widths, so the placeholder reads as names of differing length. */
const ROWS = [
  { width: '42%', delay: '0ms' },
  { width: '58%', delay: '150ms' },
  { width: '35%', delay: '300ms' },
]

/**
 * The milestone list while it loads.
 *
 * Every measurement here is the real row's (`MilestoneRow`): the same `h-12`,
 * the same `gap-3 px-4`, a dot the size of the status dot and a right-hand bar
 * the width of the progress column. A placeholder of some other height makes
 * the list jump the moment the data lands, which reads as a second load.
 *
 * The bars stagger their pulse so the block shimmers instead of blinking as one
 * slab.
 */
export function MilestoneListSkeleton() {
  return (
    <div
      className='divide-y divide-border overflow-hidden rounded-lg border border-border'
      aria-busy='true'
    >
      {ROWS.map(row => (
        <div key={row.width} className='flex h-12 items-center gap-3 px-4'>
          <Skeleton
            className='size-2 shrink-0 rounded-full'
            style={{ animationDelay: row.delay }}
          />
          <Skeleton
            className='h-3 rounded-full'
            style={{ width: row.width, animationDelay: row.delay }}
          />
          <div className='flex-1' />
          <Skeleton
            className='h-3 w-[140px] shrink-0 rounded-full'
            // Trails its own row's title bar, so each row resolves left to right.
            style={{ animationDelay: `${parseInt(row.delay, 10) + 200}ms` }}
          />
        </div>
      ))}
    </div>
  )
}
