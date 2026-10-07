import type React from 'react'
import type { Metadata } from 'next'
import { Inter, Source_Code_Pro } from 'next/font/google'
import './globals.css'
import { Suspense } from 'react'
import { Providers } from '@/components/core/Providers'
import { Toaster } from '@/components/ui/sonner'
import { resolveAuthProvider } from '@/lib/auth/provider'

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
        {/* AUTH_PROVIDER picks Clerk or Better Auth (LUM-1027). */}
        <Providers authProvider={resolveAuthProvider()}>
          <Suspense>{children}</Suspense>
          <Toaster position='top-center' />
        </Providers>
      </body>
    </html>
  )
}
