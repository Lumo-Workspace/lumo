import type { ReactNode } from 'react'

/** A labeled cell — the variant rendered above its name. */
export function VariantCell({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className='flex flex-col items-start gap-2'>
      <div className='flex min-h-12 items-center'>{children}</div>
      <code className='text-caption text-muted-foreground'>{label}</code>
    </div>
  )
}

export function VariantGrid({ children }: { children: ReactNode }) {
  return (
    <div className='flex flex-wrap gap-x-8 gap-y-6'>{children}</div>
  )
}
