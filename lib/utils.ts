import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Register the LUM-260 semantic typography tiers (defined in app/globals.css)
// as font-size utilities. Without this, tailwind-merge classifies them in the
// text-color group and drops the color when a tier and a color class are merged
// (e.g. cn('text-caption text-muted-foreground') would lose the color).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['caption', 'body', 'body-strong', 'title', 'heading', 'display'],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
