import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * A line box the height of the real text line it stands in for, with a
 * thinner bar centred inside it. The box — not the bar — decides the
 * placeholder's height, so a skeleton built from these lines occupies the
 * same space as the content that replaces it.
 */
export function SkeletonLine({
  boxHeight,
  barHeight = 'h-3',
  width,
  delay = 0,
  className,
}: {
  boxHeight: string
  barHeight?: string
  width: string
  delay?: number
  className?: string
}) {
  return (
    <div
      className={cn('flex items-center', className)}
      style={{ height: boxHeight }}
    >
      <Skeleton
        className={`${barHeight} rounded-full`}
        style={{ width, animationDelay: `${delay}ms` }}
      />
    </div>
  )
}

/** Line-box heights of the type scale (font-size × line-height). */
export const LINE = {
  caption: '16.8px',
  body: '21px',
  title: '22.4px',
} as const

/** Title widths that repeat down a list so rows don't read as one slab. */
export const ROW_WIDTHS = ['62%', '44%', '71%', '53%', '38%', '66%', '48%']

/** Pulse offset for row `i`, wrapping so long lists don't drift out of sync. */
export function rowDelay(i: number): number {
  return (i % 4) * 120
}
