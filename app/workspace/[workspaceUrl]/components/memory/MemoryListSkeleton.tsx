import { Skeleton } from '@/components/ui/skeleton'

/**
 * One placeholder per card: a title width plus the body-line widths of each
 * section. Real memories carry two to four sections of one to three lines, so
 * the three placeholders span that range instead of repeating one slab.
 */
const CARDS = [
  {
    title: '45%',
    sections: [
      ['92%', '60%'],
      ['88%', '54%'],
    ],
    delay: 0,
  },
  { title: '62%', sections: [['84%'], ['96%', '48%']], delay: 150 },
  { title: '38%', sections: [['90%'], ['72%']], delay: 300 },
]

/**
 * A line box the size of the real text line it stands in for, with a thinner
 * bar centred inside it. Keeping the *box* at the card's line height is what
 * makes the skeleton the same height as the card that replaces it — a bar of
 * some other height would make the list jump when the data lands.
 */
function Line({
  boxHeight,
  barHeight,
  width,
  delay,
}: {
  boxHeight: string
  barHeight: string
  width: string
  delay: number
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

/**
 * The memory list while it loads.
 *
 * Every wrapper here is MemoryCard's — the same `rounded-md border px-4 py-3`
 * shell, the same `mb-1.5` header row, the same `mt-2.5 / mt-0.5` section
 * rhythm, the same 14/20/21px line boxes — so three placeholders occupy the
 * space three cards will (measured: 158–200px against real cards' 168–212).
 *
 * The bars stagger their pulse (and each section trails its own title) so the
 * block shimmers instead of blinking as one slab.
 */
export function MemoryListSkeleton() {
  return (
    <div className='space-y-2' aria-busy='true' data-testid='memory-skeleton'>
      {CARDS.map(card => (
        <div
          key={card.title}
          className='rounded-md border border-border bg-card px-4 py-3'
        >
          {/* Header: category dot + label on the left, source chip on the right. */}
          <div className='mb-1.5 flex h-[14px] items-center justify-between gap-2'>
            <span className='flex items-center gap-1.5'>
              <Skeleton
                className='size-[7px] shrink-0 rounded-full'
                style={{ animationDelay: `${card.delay}ms` }}
              />
              <Skeleton
                className='h-2 w-16 rounded-full'
                style={{ animationDelay: `${card.delay}ms` }}
              />
            </span>
            <Skeleton
              className='h-2 w-20 shrink-0 rounded-full'
              style={{ animationDelay: `${card.delay + 100}ms` }}
            />
          </div>

          <Line
            boxHeight='20px'
            barHeight='h-3'
            width={card.title}
            delay={card.delay}
          />

          {card.sections.map((lines, i) => (
            <div key={lines.join()} className='mt-2.5'>
              <Line
                boxHeight='14px'
                barHeight='h-2'
                width='72px'
                delay={card.delay + 100 * (i + 1)}
              />
              <div className='mt-0.5'>
                {lines.map((width, j) => (
                  <Line
                    key={`${width}-${j}`}
                    boxHeight='21px'
                    barHeight='h-3'
                    width={width}
                    delay={card.delay + 100 * (i + 2)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
