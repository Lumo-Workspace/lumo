import type React from 'react'
import type { Metadata } from 'next'
import { Inter, Source_Code_Pro } from 'next/font/google'
import './globals.css'
import { Suspense } from 'react'
import { Providers } from '@/components/core/Providers'
import { Toaster } from '@/components/ui/toaster'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

const sourceCodePro = Source_Code_Pro({
  variable: '--font-source-code-pro',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Document PM Platform',
  description: 'Document and Project Management Platform with Kanban View',
  generator: 'v0.app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang='en'
      className={`${inter.variable} ${sourceCodePro.variable} antialiased`}
    >
      <body className='font-sans'>
        <Providers>
          <Suspense>{children}</Suspense>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
