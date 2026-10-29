import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import { LINE, ROW_WIDTHS, SkeletonLine, rowDelay } from './SkeletonLine'

/**
 * The Documents list while it loads — DocumentsPage's list row shell
 * (`px-3 py-2.5`, emoji, title + subtitle, creator, updated-at) so the rows
 * keep their height when the documents land.
 */
export function DocumentListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      data-testid='document-list-skeleton'
      className='divide-y divide-border'
    >
      {Array.from({ length: rows }, (_, i) => {
        const delay = rowDelay(i)
        return (
          <div key={i} className='flex items-center gap-3 px-3 py-2.5'>
            <Skeleton
              className='size-5 shrink-0 rounded-md'
              style={{ animationDelay: `${delay}ms` }}
            />
            <div className='min-w-0 flex-1'>
              <SkeletonLine
                boxHeight={LINE.body}
                width={ROW_WIDTHS[i % ROW_WIDTHS.length]!}
                delay={delay}
              />
              <SkeletonLine
                boxHeight={LINE.caption}
                barHeight='h-2'
                width='28%'
                delay={delay + 100}
              />
            </div>
            <span className='hidden shrink-0 items-center gap-1.5 sm:flex'>
              <Skeleton
                className='size-4 rounded-full'
                style={{ animationDelay: `${delay + 100}ms` }}
              />
              <Skeleton
                className='h-2.5 w-16 rounded-full'
                style={{ animationDelay: `${delay + 100}ms` }}
              />
            </span>
            <div className='flex w-16 shrink-0 justify-end'>
              <Skeleton
                className='h-2.5 w-12 rounded-full'
                style={{ animationDelay: `${delay + 200}ms` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Preview line widths inside each grid card. */
const PREVIEW_LINES = ['94%', '86%', '90%', '72%', '58%']

/**
 * The Documents grid while it loads — the same `h-64 p-4` Card shell as a
 * real document card: emoji + title, preview lines, creator footer.
 */
export function DocumentGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div
      aria-hidden
      data-testid='document-grid-skeleton'
      className='grid grid-cols-1 gap-8 pb-4 sm:grid-cols-2 lg:grid-cols-3'
    >
      {Array.from({ length: cards }, (_, i) => {
        const delay = rowDelay(i)
        return (
          <Card key={i} className='flex h-64 flex-col p-4'>
            <div className='flex items-center gap-2'>
              <Skeleton
                className='size-5 shrink-0 rounded-md'
                style={{ animationDelay: `${delay}ms` }}
              />
              <SkeletonLine
                boxHeight={LINE.body}
                width={ROW_WIDTHS[i % ROW_WIDTHS.length]!}
                delay={delay}
                className='flex-1'
              />
            </div>
            <div className='mt-3 flex-1 overflow-hidden'>
              {PREVIEW_LINES.map((width, j) => (
                <SkeletonLine
                  key={j}
                  boxHeight={LINE.caption}
                  barHeight='h-2'
                  width={width}
                  delay={delay + 100}
                />
              ))}
            </div>
            <div className='mt-3 flex items-center gap-2'>
              <Skeleton
                className='size-5 rounded-full'
                style={{ animationDelay: `${delay + 200}ms` }}
              />
              <Skeleton
                className='h-2.5 w-24 rounded-full'
                style={{ animationDelay: `${delay + 200}ms` }}
              />
            </div>
          </Card>
        )
      })}
    </div>
  )
}

/** Body paragraph widths for the editor placeholder. */
const PARAGRAPHS = [
  ['96%', '92%', '64%'],
  ['90%', '82%'],
  ['94%', '88%', '76%', '40%'],
]

/**
 * The document editor while the document loads: a title bar over a few
 * paragraphs of body lines.
 */
export function DocumentEditorSkeleton() {
  return (
    <div
      aria-hidden
      data-testid='document-editor-skeleton'
      className='mx-auto w-full max-w-3xl px-8 pt-20'
    >
      <Skeleton className='mb-4 size-10 rounded-md' />
      <SkeletonLine boxHeight='44px' barHeight='h-7' width='48%' />
      <div className='mt-8 space-y-5'>
        {PARAGRAPHS.map((lines, p) => (
          <div key={p}>
            {lines.map((width, j) => (
              <SkeletonLine
                key={j}
                boxHeight='24px'
                width={width}
                delay={rowDelay(p) + j * 60}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
