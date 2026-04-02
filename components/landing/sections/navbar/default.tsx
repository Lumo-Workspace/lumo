'use client'

import { type VariantProps } from 'class-variance-authority'
import { Menu } from 'lucide-react'
import { ReactNode } from 'react'

import { siteConfig } from '@/components/landing/config'
import { cn } from '@/lib/utils'

import { Button, buttonVariants } from '../../ui/button'
import {
  Navbar as NavbarComponent,
  NavbarLeft,
  NavbarRight,
} from '../../ui/navbar'
import { Sheet, SheetContent, SheetTrigger } from '../../ui/sheet'

interface NavbarLink {
  text: string
  href: string
}

interface NavbarActionProps {
  text: string
  href: string
  variant?: VariantProps<typeof buttonVariants>['variant']
  icon?: ReactNode
  iconRight?: ReactNode
  isButton?: boolean
}

interface NavbarProps {
  logo?: ReactNode
  name?: string
  homeUrl?: string
  mobileLinks?: NavbarLink[]
  actions?: NavbarActionProps[]
  navLinks?: NavbarLink[]
  className?: string
}

export default function Navbar({
  // eslint-disable-next-line @next/next/no-img-element
  logo = <img src='/logo-dark.svg' alt='Lumo' className='h-8 w-auto' />,
  name = 'Lumo',
  homeUrl = siteConfig.url,
  mobileLinks = [
    { text: 'Features', href: '#features' },
    { text: 'Pricing', href: '#pricing' },
    { text: 'FAQ', href: '#faq' },
  ],
  actions = [
    {
      text: 'Join Waitlist',
      href: '/signup',
      isButton: true,
      variant: 'default',
    },
  ],
  navLinks = [
    { text: 'Features', href: '#features' },
    { text: 'Pricing', href: '#pricing' },
    { text: 'FAQ', href: '#faq' },
  ] as NavbarLink[],
  className,
}: NavbarProps) {
  return (
    <header className={cn('sticky top-0 z-50 -mb-4 px-4 pb-4', className)}>
      <div className='fade-bottom bg-background/15 absolute left-0 h-24 w-full backdrop-blur-lg'></div>
      <div className='max-w-container relative mx-auto'>
        <NavbarComponent>
          <NavbarLeft>
            <a
              href={homeUrl}
              className='flex items-center gap-2 text-xl font-bold'
            >
              {logo}
              {name}
            </a>
            <nav className='hidden items-center gap-6 md:flex'>
              {navLinks.map((link, index) => (
                <a
                  key={index}
                  href={link.href}
                  className='text-muted-foreground hover:text-foreground text-sm transition-colors'
                >
                  {link.text}
                </a>
              ))}
            </nav>
          </NavbarLeft>
          <NavbarRight>
            {actions.map((action, index) =>
              action.isButton ? (
                <Button
                  key={index}
                  variant={action.variant || 'default'}
                  asChild
                >
                  <a href={action.href}>
                    {action.icon}
                    {action.text}
                    {action.iconRight}
                  </a>
                </Button>
              ) : (
                <a
                  key={index}
                  href={action.href}
                  className='hidden text-sm md:block'
                >
                  {action.text}
                </a>
              )
            )}
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='shrink-0 md:hidden'
                >
                  <Menu className='size-5' />
                  <span className='sr-only'>Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side='right'>
                <nav className='grid gap-6 text-lg font-medium'>
                  <a
                    href={homeUrl}
                    className='flex items-center gap-2 text-xl font-bold'
                  >
                    <span>{name}</span>
                  </a>
                  {mobileLinks.map((link, index) => (
                    <a
                      key={index}
                      href={link.href}
                      className='text-muted-foreground hover:text-foreground'
                    >
                      {link.text}
                    </a>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </NavbarRight>
        </NavbarComponent>
      </div>
    </header>
  )
}
