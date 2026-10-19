'use client'

import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'

import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

const Collapsible = CollapsiblePrimitive.Root

/**
 * Marks itself `group/collapsible`, so a chevron inside can turn with
 * `group-data-[state=open]/collapsible:rotate-90` without its own open flag.
 */
const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleTrigger
    ref={ref}
    className={cn('group/collapsible', className)}
    {...props}
  />
))
CollapsibleTrigger.displayName =
  CollapsiblePrimitive.CollapsibleTrigger.displayName

/**
 * Height animates from the measured content height. The duration token
 * collapses to 0.01ms under prefers-reduced-motion (app/globals.css).
 */
const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleContent
    ref={ref}
    className={cn(
      'overflow-hidden duration-base ease-standard data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
      className
    )}
    {...props}
  />
))
CollapsibleContent.displayName =
  CollapsiblePrimitive.CollapsibleContent.displayName

/**
 * A disclosure whose root is a Card surface: the Collapsible root renders the
 * Card surface instead of a bare div. Takes the
 * same props as `Collapsible`; `className` adjusts the card.
 */
const CollapsibleCard = React.forwardRef<
  HTMLDivElement,
  Omit<
    React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root>,
    'asChild'
  >
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Root asChild {...props}>
    <Card ref={ref} className={className}>
      {children}
    </Card>
  </CollapsiblePrimitive.Root>
))
CollapsibleCard.displayName = 'CollapsibleCard'

export { Collapsible, CollapsibleCard, CollapsibleTrigger, CollapsibleContent }
