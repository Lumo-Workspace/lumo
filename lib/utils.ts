import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Register the LUM-260 semantic typography tiers (defined in app/globals.css)
// as font-size utilities. Without this, tailwind-merge classifies them in the
// text-color group and drops the color when a tier and a color class are merged
// (e.g. cn('text-caption text-muted-foreground') would lose the color).
//
// Register the LUM-287 control-size tokens (--spacing-control-* in
// app/globals.css) as spacing theme values, so h-control-md, w-control-md,
// px-control-inset-sm … merge like h-9 / px-3: a className override such as
// `h-8`, `size-7` or `p-0` on a Button/Input/Badge replaces the variant's token
// class instead of silently losing to it in the cascade (LUM-1273).
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
