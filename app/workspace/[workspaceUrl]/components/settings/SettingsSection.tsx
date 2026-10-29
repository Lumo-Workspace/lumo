'use client'

import type { ReactNode } from 'react'

/** One titled group on a settings page; `id` is its in-page anchor (LUM-1327). */
export function SettingsSection({
  id,
  title,
  children,
}: {
  id: string
  /** Omitted when the group's only card carries its own header (danger zone). */
  title?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={title ? `${id}-heading` : undefined}
      className='scroll-mt-16 mb-10 [&>*:last-child]:mb-0'
    >
      {title && (
        <h2
          id={`${id}-heading`}
          className='text-body-strong text-foreground mb-3'
        >
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}
