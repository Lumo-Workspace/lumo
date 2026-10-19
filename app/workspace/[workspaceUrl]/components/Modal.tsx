'use client'

import { useState } from 'react'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'

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
  // layoutExpanded lags behind on collapse: only flips false after the animation ends
  // so children's flex layout doesn't reflow mid-animation (causing the selector jump).
  const [layoutExpanded, setLayoutExpanded] = useState(false)

  const handleToggleExpand = () => {
    if (!expanded) {
      setLayoutExpanded(true)
      setExpanded(true)
    } else {
      setExpanded(false)
      // layoutExpanded → false deferred to onAnimationComplete
    }
  }

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-modal flex items-end sm:items-center justify-center sm:p-4'>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className='absolute inset-0 bg-black/50'
      />
      {/* Container: no height animation — stays height:auto so footer is always naturally anchored */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2 }}
        style={{ width: '100%', maxWidth: 860 }}
        className='relative bg-card rounded-t-xl sm:rounded-xl shadow-elevation-3 border border-border overflow-hidden flex flex-col w-full max-h-[90vh]'
      >
        {/* Header */}
        <div className='px-6 py-4 flex items-center justify-between border-b border-border shrink-0'>
          <h3 className='text-lg font-semibold text-foreground'>{title}</h3>
          <div className='flex items-center gap-1'>
            {expandable && (
              <Button
                variant='ghost'
                size='icon'
                onClick={handleToggleExpand}
                className='h-7 w-7 text-muted-foreground hover:text-foreground'
                title={expanded ? 'Collapse' : 'Expand'}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </Button>
            )}
            <Button
              variant='ghost'
              size='icon'
              onClick={onClose}
              className='h-7 w-7 text-muted-foreground hover:text-foreground'
            >
              <X size={18} />
            </Button>
          </div>
        </div>

        {/* Body — only this section animates height, footer stays put */}
        <motion.div
          animate={{ height: expanded ? '70vh' : 'auto' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className='overflow-y-auto'
          style={{ minHeight: 0, maxHeight: expanded ? '70vh' : '40vh' }}
          onAnimationComplete={() => {
            if (!expanded) setLayoutExpanded(false)
          }}
        >
          <div
            className={`p-6 h-full ${layoutExpanded ? 'flex flex-col' : ''}`}
          >
            {typeof children === 'function'
              ? children(layoutExpanded)
              : children}
          </div>
        </motion.div>

        {/* Footer */}
        {footer && (
          <div className='px-6 py-4 bg-muted/50 border-t border-border flex items-center justify-end shrink-0'>
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  )
}
