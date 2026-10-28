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

/** Sticky jump links to a page's `SettingsSection`s. */
export function SettingsSectionNav({
  label,
  items,
}: {
  /** Accessible name of the nav landmark. */
  label: string
  items: readonly { id: string; label: string }[]
}) {
  return (
    <nav
      aria-label={label}
      className='sticky top-0 z-10 -mx-6 mb-6 flex flex-wrap gap-1 border-b border-border bg-card px-6 py-2'
    >
      {items.map(item => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className='rounded-md px-2 py-1 text-body text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
