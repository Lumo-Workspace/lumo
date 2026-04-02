import '@/components/landing/landing.css'
import CTA from '@/components/landing/sections/cta/default'
import FAQ from '@/components/landing/sections/faq/default'
import Footer from '@/components/landing/sections/footer/default'
import Hero from '@/components/landing/sections/hero/default'
import Items from '@/components/landing/sections/items/default'
import Logos from '@/components/landing/sections/logos/default'
import Navbar from '@/components/landing/sections/navbar/default'
import Pricing from '@/components/landing/sections/pricing/default'
import Stats from '@/components/landing/sections/stats/default'
import { LayoutLines } from '@/components/landing/ui/layout-lines'

export default function HomePage() {
  return (
    <main className='dark landing bg-background text-foreground min-h-screen w-full'>
      <LayoutLines />
      <Navbar />
      <Hero />
      <Logos />
      <Items />
      <Stats />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
    </main>
  )
}
