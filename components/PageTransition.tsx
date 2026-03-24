'use client'

import { AnimatePresence, motion } from 'motion/react'

interface PageTransitionProps {
  /** Unique key for the current page — changing it triggers the transition */
  pageKey: string
  children: React.ReactNode
  className?: string
}

/**
 * Wraps page content with a fade-in transition.
 * Old page exits instantly; new page fades in over 120ms.
 *
 * Usage:
 *   <PageTransition pageKey={currentPage}>
 *     {renderPage()}
 *   </PageTransition>
 */
export function PageTransition({
  pageKey,
  children,
  className,
}: PageTransitionProps) {
  return (
    <AnimatePresence mode='wait'>
      <motion.div
        key={pageKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0 } }}
        transition={{ duration: 0.12 }}
        className={className ?? 'absolute inset-0 flex flex-col'}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
