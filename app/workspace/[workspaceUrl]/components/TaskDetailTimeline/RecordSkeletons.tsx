import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

/**
 * Loading placeholders for the Record tab's regions. Each one reuses the shell
 * of the thing it stands in for (same border, padding and line boxes) so the
 * tab does not jump when the data lands. The visible bars are aria-hidden; the
 * caller's loading label rides along as sr-only text for screen readers.
 */

/**
 * A line box the height of the real text line, with a thinner bar centred in
 * it — the box, not the bar, decides the placeholder's height.
 */
function Line({
  boxHeight,
  barHeight,
  width,
  delay = 0,
}: {
  boxHeight: string
  barHeight: string
  width: string
  delay?: number
}) {
  return (
    <div className='flex items-center' style={{ height: boxHeight }}>
      <Skeleton
        className={`${barHeight} rounded-full`}
        style={{ width, animationDelay: `${delay}ms` }}
      />
    </div>
  )
}

/** Detail-column widths of the three gate rows (crossings / security / tests). */
const GATE_ROWS = ['58%', '44%', '66%']

/** RecordDoneGate's card: caption + heading, then one bordered row per gate. */
export function DoneGateSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy='true'
      data-testid='record-skeleton'
      className='overflow-hidden rounded-lg border border-border'
    >
      <span className='sr-only'>{label}</span>
      <div aria-hidden className='px-5 pb-4 pt-4'>
        <Line boxHeight='16.8px' barHeight='h-2' width='96px' />
        <div className='mt-1'>
          <Line boxHeight='26px' barHeight='h-4' width='40%' delay={100} />
        </div>
      </div>
      {GATE_ROWS.map((width, i) => (
        <div
          key={width}
          aria-hidden
          className='flex items-center gap-x-3 border-t border-border px-5 py-3'
        >
          <Skeleton
            className='size-5 shrink-0 rounded-full'
            style={{ animationDelay: `${150 * (i + 1)}ms` }}
          />
          <div className='w-40 shrink-0'>
            <Line
              boxHeight='21px'
              barHeight='h-3'
              width='70%'
              delay={150 * (i + 1)}
            />
          </div>
          <div className='min-w-0 grow'>
            <Line
              boxHeight='21px'
              barHeight='h-3'
              width={width}
              delay={150 * (i + 1) + 100}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Title widths of the placeholder cases. */
const CASES = ['52%', '38%']

/** Collapsed TestCaseCard headers: chevron, verdict icon, "Test case N", title. */
export function TestCaseListSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy='true'
      data-testid='test-cases-skeleton'
      className='flex flex-col gap-2'
    >
      <span className='sr-only'>{label}</span>
      {CASES.map((width, i) => (
        <div
          key={width}
          aria-hidden
          className='flex items-center gap-x-2.5 overflow-hidden rounded-lg border border-border px-4 py-3'
        >
          <Skeleton
            className='size-3.5 shrink-0 rounded-sm'
            style={{ animationDelay: `${150 * i}ms` }}
          />
          <Skeleton
            className='size-3.5 shrink-0 rounded-full'
            style={{ animationDelay: `${150 * i}ms` }}
          />
          <Line
            boxHeight='21px'
            barHeight='h-3'
            width='72px'
            delay={150 * i + 100}
          />
          <div className='min-w-0 grow'>
            <Line
              boxHeight='21px'
              barHeight='h-3'
              width={width}
              delay={150 * i + 200}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Body-line widths under the lineage summary row. */
const LINEAGE_LINES = ['82%', '64%', '74%']

/** LineageTab's card: the summary row, then a few body lines. */
export function LineageSkeleton({ label }: { label: string }) {
  return (
    <Card aria-busy='true' data-testid='lineage-skeleton'>
      <span className='sr-only'>{label}</span>
      <div aria-hidden className='border-b border-border px-3 py-2'>
        <Line boxHeight='16.8px' barHeight='h-2' width='45%' />
      </div>
      <div aria-hidden className='space-y-1 px-3 py-3'>
        {LINEAGE_LINES.map((width, i) => (
          <Line
            key={width}
            boxHeight='16.8px'
            barHeight='h-2'
            width={width}
            delay={100 * (i + 1)}
          />
        ))}
      </div>
    </Card>
  )
}
