import type React from 'react'
import type { Metadata } from 'next'
import { Inter, Source_Code_Pro } from 'next/font/google'
import './globals.css'
import { Suspense } from 'react'
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
  title: 'Lumo — Your agents say it\u2019s done. Lumo proves it.',
  description:
    'Delivery verification for teams that ship with AI. Freeze acceptance criteria before work starts, verify every delivery against evidence, and meter every token along the way.',
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
        <Providers>
          <Suspense>{children}</Suspense>
          <Toaster position='top-center' />
        </Providers>
      </body>
    </html>
  )
}
