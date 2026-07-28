'use client'

/**
 * One label-and-value row of the Project page's property block.
 *
 * The 90px label gutter is what keeps Properties / Repos / Health reading as a
 * single column of facts. Shared rather than repeated so the three rows cannot
 * drift apart by a few pixels — and so a section that needs to break out of the
 * gutter (the health row's detail panel) can do it deliberately, by rendering
 * outside this component instead of by re-guessing the offset.
 */
export function PropertyRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex items-start gap-3.5 py-1'>
      <div className='w-[90px] shrink-0 pt-1.5 text-caption text-muted-foreground'>
        {label}
      </div>
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
        {children}
      </div>
    </div>
  )
}
