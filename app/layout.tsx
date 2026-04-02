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
  title: 'Lumo — Execution OS for Builders',
  description:
    'Turn your app idea into a structured, actionable build plan in seconds.',
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
