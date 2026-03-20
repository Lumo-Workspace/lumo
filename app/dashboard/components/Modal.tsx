'use client'

import { useState } from 'react'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { motion } from 'motion/react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode | ((expanded: boolean) => React.ReactNode)
  footer?: React.ReactNode
  expandable?: boolean
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  expandable = true,
}: ModalProps) {
  const [expanded, setExpanded] = useState(false)

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className='absolute inset-0 bg-black/40 backdrop-blur-sm'
      />
      {/* Container: no height animation — stays height:auto so footer is always naturally anchored */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2 }}
        style={{ width: '100%', maxWidth: 860 }}
        className='relative bg-white dark:bg-zinc-950 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col'
      >
        {/* Header */}
        <div className='px-6 py-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900 shrink-0'>
          <h3 className='text-lg font-semibold text-zinc-900 dark:text-zinc-100'>
            {title}
          </h3>
          <div className='flex items-center gap-1'>
            {expandable && (
              <button
                onClick={() => setExpanded(e => !e)}
                className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors p-1 rounded'
                title={expanded ? 'Collapse' : 'Expand'}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            )}
            <button
              onClick={onClose}
              className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors p-1 rounded'
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body — only this section animates height, footer stays put */}
        <motion.div
          animate={{ height: expanded ? '55vh' : 'auto' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className='overflow-hidden'
          style={{ minHeight: 0 }}
        >
          <div className={`p-6 h-full ${expanded ? 'flex flex-col' : ''}`}>
            {typeof children === 'function' ? children(expanded) : children}
          </div>
        </motion.div>

        {/* Footer */}
        {footer && (
          <div className='px-6 py-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-900 flex items-center justify-end shrink-0'>
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  )
}
