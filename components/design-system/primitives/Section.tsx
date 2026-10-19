import type { ReactNode } from 'react'

export function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className='scroll-mt-20 border-b border-border py-10'>
      <h2 className='mb-6 text-title text-foreground'>{title}</h2>
      {children}
    </section>
  )
}
