import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap border text-caption transition-colors focus:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary font-semibold text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary font-semibold text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive font-semibold text-destructive-foreground hover:bg-destructive/80',
        outline: 'border-border text-foreground',
        /** Quiet bordered metadata chip (scope, environment, attribution). */
        'outline-muted': 'border-border text-muted-foreground',
        /** Neutral filled chip — counts, drafts, greyscale evidence. */
        muted: 'border-transparent bg-muted text-muted-foreground',
        // Subtle feedback tones: -subtle fill, -border edge, -text label.
        info: 'border-info-border bg-info-subtle text-info-text',
        success: 'border-success-border bg-success-subtle text-success-text',
        warning: 'border-warning-border bg-warning-subtle text-warning-text',
        danger: 'border-danger-border bg-danger-subtle text-danger-text',
        /** No colour of its own — for chips whose colour is data (user tags). */
        plain: 'border-transparent',
      },
      size: {
        default: 'px-control-inset-sm py-0.5',
        sm: 'px-2 py-0.5',
        /** Tight chips: counts and square tag/metadata chips. */
        xs: 'px-1.5 py-0.5',
      },
      shape: {
        pill: 'rounded-full',
        square: 'rounded-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      shape: 'pill',
    },
  }
)

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  ref?: React.Ref<HTMLSpanElement>
}

function Badge({ className, variant, size, shape, ...props }: BadgeProps) {
  return (
    <span
      data-slot='badge'
      className={cn(badgeVariants({ variant, size, shape }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
