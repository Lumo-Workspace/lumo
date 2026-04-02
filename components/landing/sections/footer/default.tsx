import Link from 'next/link'
import { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface FooterLink {
  text: string
  href: string
}

interface FooterColumnProps {
  title: string
  links: FooterLink[]
}

interface FooterProps {
  logo?: ReactNode
  name?: string
  tagline?: string
  copyright?: string
  columns?: FooterColumnProps[]
  className?: string
}

export default function FooterSection({
  // eslint-disable-next-line @next/next/no-img-element
  logo = <img src='/logo-dark.svg' alt='Lumo' className='h-10 w-auto' />,
  name = 'Lumo',
  tagline = 'Project management for AI-native teams.',
  copyright = '© 2026 Lumo. All rights reserved.',
  columns = [
    {
      title: 'Product',
      links: [
        { text: 'Features', href: '#features' },
        { text: 'Pricing', href: '#pricing' },
        { text: 'FAQ', href: '#faq' },
      ],
    },
    {
      title: 'Connect',
      links: [{ text: 'hello@uselumo.ai', href: 'mailto:hello@uselumo.ai' }],
    },
  ],
  className,
}: FooterProps) {
  return (
    <footer className={cn('bg-background w-full px-4 pb-8', className)}>
      <div className='max-w-container mx-auto flex flex-col gap-10'>
        {/* Top: Logo */}
        <Link href='/' className='flex items-center gap-3'>
          {logo}
          <span className='text-4xl font-bold'>{name}</span>
        </Link>

        <hr className='border-border/40' />

        {/* Bottom: Tagline + Columns */}
        <div className='flex flex-col justify-between gap-8 md:flex-row'>
          <div className='flex flex-col gap-2'>
            <p className='text-muted-foreground text-sm font-medium'>
              {tagline}
            </p>
            <p className='text-muted-foreground/60 text-xs'>{copyright}</p>
          </div>
          <div className='flex gap-16'>
            {columns.map((column, index) => (
              <div key={index} className='flex flex-col gap-3'>
                <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground/60'>
                  {column.title}
                </h3>
                {column.links.map((link, linkIndex) => (
                  <a
                    key={linkIndex}
                    href={link.href}
                    className='text-muted-foreground hover:text-foreground text-sm transition-colors'
                  >
                    {link.text}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
