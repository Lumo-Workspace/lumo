import { type ReactNode } from 'react'

interface CliStepProps {
  index: number
  title: string
  description: string
  children?: ReactNode
}

export function CliStep({ index, title, description, children }: CliStepProps) {
  return (
    <section className='flex gap-4 mb-8'>
      <div
        aria-hidden
        className='shrink-0 w-7 h-7 rounded-full bg-muted text-muted-foreground text-sm font-semibold flex items-center justify-center mt-0.5'
      >
        {index}
      </div>
      <div className='flex-1 min-w-0 space-y-3'>
        <div>
          <h2 className='text-sm font-semibold text-foreground'>{title}</h2>
          <p className='text-xs text-muted-foreground mt-1'>{description}</p>
        </div>
        {children}
      </div>
    </section>
  )
}
