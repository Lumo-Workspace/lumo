import {
  Bricolage_Grotesque,
  Hanken_Grotesk,
  JetBrains_Mono,
} from 'next/font/google'

import { LumoHome } from '@/components/landing/home/lumo-home'

// Marketing-only typefaces for the homepage brand fork. Loaded as variable
// fonts (no fixed `weight`) so intermediate weights resolve correctly via CSS.
// Display headings use Bricolage Grotesque — a sans with editorial character
// and hook-free L/l letterforms (replaces the serif Newsreader).
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
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
      className={`${hanken.variable} ${bricolage.variable} ${jetbrainsMono.variable}`}
    />
  )
}
