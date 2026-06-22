import { Hanken_Grotesk, JetBrains_Mono, Newsreader } from 'next/font/google'

import { LumoHome } from '@/components/landing/home/lumo-home'

// Marketing-only typefaces for the homepage brand fork. Loaded as variable
// fonts (no fixed `weight`) so the design's intermediate weights — e.g.
// Newsreader 440 for display headings — resolve correctly via CSS.
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})
const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
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
      className={`${hanken.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}
    />
  )
}
