'use client'
import React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export const AuroraBackground = ({
  children,
  className,
  showRadialGradient = true,
  ...props
}: {
  children: React.ReactNode
  className?: string
  showRadialGradient?: boolean
}) => {
  return (
    <main
      className={cn(
        'relative flex flex-col h-full items-center justify-center bg-zinc-50 dark:bg-zinc-900 text-slate-950 transition-bg',
        className
      )}
      {...props}
    >
      <div className='absolute inset-0 overflow-hidden'>
        <div className='absolute -inset-[10px] opacity-50'>
          <div className='absolute top-0 -left-4 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl animate-blob'></div>
          <div className='absolute top-0 -right-4 w-72 h-72 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000'></div>
          <div className='absolute -bottom-8 left-20 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-4000'></div>
        </div>
        {showRadialGradient && (
          <div className='absolute inset-0 bg-gradient-to-r from-blue-50 to-indigo-100 dark:from-blue-950/20 dark:to-indigo-950/20 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]'></div>
        )}
      </div>
      {children}
    </main>
  )
}
