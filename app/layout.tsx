import type React from 'react'
import type { Metadata } from 'next'
import { Inter, Source_Code_Pro } from 'next/font/google'
import './globals.css'
import { Suspense } from 'react'
import Script from 'next/script'
import { Providers } from '@/components/core/Providers'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

const sourceCodePro = Source_Code_Pro({
  variable: '--font-source-code-pro',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Lumo — Your agents got 10x faster. Your review didn\u2019t.',
  description:
    'Agentic Project Management. Record every test run with its evidence, scan every pull request before it merges, and meter every token along the way.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang='en'
      suppressHydrationWarning
      className={`${inter.variable} ${sourceCodePro.variable} antialiased`}
    >
      <body className='font-sans'>
        {/* LUM-1325: runtime NEXT_PUBLIC_* values (app URL, realtime host),
            so a prebuilt image works on any domain. */}
        <Script src='/api/public-config' strategy='beforeInteractive' />
        <Providers>
          <Suspense>{children}</Suspense>
          <Toaster position='top-center' />
        </Providers>
      </body>
    </html>
  )
}
