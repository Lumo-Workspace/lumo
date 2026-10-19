import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Register the LUM-260 semantic typography tiers (defined in app/globals.css)
// as font-size utilities. Without this, tailwind-merge classifies them in the
// text-color group and drops the color when a tier and a color class are merged
// (e.g. cn('text-caption text-muted-foreground') would lose the color).
//
// LUM-1272: the control size tokens (--spacing-control-*, LUM-287) are spacing
// values too. Unregistered, `cn('h-control-sm px-control-inset-sm', 'h-auto
// p-0')` kept both heights and both paddings, so a className override on a
// Button / Input silently lost to the base size depending on CSS order.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        'control-sm',
        'control-md',
        'control-lg',
        'control-inset-sm',
        'control-inset-md',
        'control-inset-lg',
      ],
    },
    classGroups: {
      'font-size': [
        {
          text: [
            'caption',
            'body',
            'body-strong',
            'title',
            'heading',
            'display',
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
