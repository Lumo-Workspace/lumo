'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// `tone` colours the indicator; every tone but `default` sits on the neutral
// muted track, the shadcn default keeps its primary-tinted one.
const progressVariants = cva('relative w-full overflow-hidden rounded-full', {
  variants: {
    tone: {
      default: 'bg-primary/20',
      success: 'bg-muted',
      info: 'bg-muted',
      danger: 'bg-muted',
      muted: 'bg-muted',
      chart: 'bg-muted',
      foreground: 'bg-muted',
    },
    size: {
      default: 'h-2',
      sm: 'h-1.5',
      xs: 'h-1',
    },
  },
  defaultVariants: {
    tone: 'default',
    size: 'default',
  },
})

const progressIndicatorVariants = cva(
  'h-full w-full flex-1 rounded-full transition-all',
  {
    variants: {
      tone: {
        default: 'bg-primary',
        success: 'bg-success-text',
        info: 'bg-info',
        danger: 'bg-danger',
        muted: 'bg-muted-foreground/50',
        chart: 'bg-chart-1',
        foreground: 'bg-foreground',
      },
    },
    defaultVariants: {
      tone: 'default',
    },
  }
)

/** Clamp to 0–100: Radix rejects a value above `max`, and an over-budget
 *  ratio (e.g. 120%) should read as a full bar. */
function clampPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export interface ProgressProps
  extends
    React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
    VariantProps<typeof progressVariants> {}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, tone, size, ...props }, ref) => {
  const pct = clampPercent(value)
  return (
    <ProgressPrimitive.Root
      ref={ref}
      data-slot='progress'
      value={pct}
      className={cn(progressVariants({ tone, size }), className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot='progress-indicator'
        className={progressIndicatorVariants({ tone })}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress, progressVariants, progressIndicatorVariants, clampPercent }
