import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const kbdVariants = cva(
  'pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm px-1 font-sans text-caption [&_svg:not([class*=size-])]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        /** On a filled surface (a primary or destructive button): tinted from
         *  the surface's own text colour so it reads on either. */
        solid: 'bg-current/15 text-current opacity-80',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

const Kbd = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & VariantProps<typeof kbdVariants>
>(({ className, variant, ...props }, ref) => (
  <kbd
    ref={ref}
    data-slot='kbd'
    className={cn(kbdVariants({ variant, className }))}
    {...props}
  />
))
Kbd.displayName = 'Kbd'

const KbdGroup = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement>
>(({ className, ...props }, ref) => (
  <kbd
    ref={ref}
    data-slot='kbd-group'
    className={cn('inline-flex items-center gap-1', className)}
    {...props}
  />
))
KbdGroup.displayName = 'KbdGroup'

export { Kbd, KbdGroup, kbdVariants }
