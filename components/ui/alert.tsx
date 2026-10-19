import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Inline notice / callout (LUM-1268). Layout: an optional leading icon (a
 * direct `<svg>` child) in its own column, everything else stacked in the
 * second column — so title, description and any actions line up without
 * per-caller spacing. Tone variants follow the feedback-token rule: the colour
 * lives in the `-subtle` fill, the `-border` outline and the `-text` icon;
 * callout text stays `text-foreground`. `size='sm'` is the compact caption
 * form used under form fields and inside cards.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-foreground [&>:not(svg)]:col-start-2',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 text-danger-text dark:border-destructive [&>svg]:text-destructive',
        info: 'border-info-border bg-info-subtle text-foreground [&>svg]:text-info-text',
        success:
          'border-success-border bg-success-subtle text-foreground [&>svg]:text-success-text',
        warning:
          'border-warning-border bg-warning-subtle text-foreground [&>svg]:text-warning-text',
        danger:
          'border-danger-border bg-danger-subtle text-foreground [&>svg]:text-danger-text',
      },
      size: {
        default: 'px-4 py-3 text-body',
        sm: 'px-3 py-2 text-caption has-[>svg]:grid-cols-[calc(var(--spacing)*3.5)_1fr] has-[>svg]:gap-x-2 [&>svg]:size-3.5 [&>svg]:translate-y-px',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, size, ...props }, ref) => (
  <div
    ref={ref}
    role='alert'
    className={cn(alertVariants({ variant, size }), className)}
    {...props}
  />
))
Alert.displayName = 'Alert'

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('text-body-strong', className)} {...props} />
))
AlertTitle.displayName = 'AlertTitle'

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('min-w-0 [&_p]:leading-relaxed', className)}
    {...props}
  />
))
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertTitle, AlertDescription, alertVariants }
