import {
  Hanken_Grotesk,
  JetBrains_Mono,
  Schibsted_Grotesk,
} from 'next/font/google'

import { LumoHome } from '@/components/landing/home/lumo-home'

// Marketing-only typefaces for the homepage brand fork. Loaded as variable
// fonts (no fixed `weight`) so intermediate weights resolve correctly via CSS.
// Display headings use Schibsted Grotesk — the closest Google-Fonts stand-in
// for Styrene (Anthropic's brand grotesque): boxy low-contrast letterforms
// with hook-free straight L/l strokes.
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})
const schibsted = Schibsted_Grotesk({
  subsets: ['latin'],
  variable: '--font-schibsted',
  display: 'swap',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export default function HomePage() {
  return (
    <LumoHome
      className={`${hanken.variable} ${schibsted.variable} ${jetbrainsMono.variable}`}
    />
  )
}
