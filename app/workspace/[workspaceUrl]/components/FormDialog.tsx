'use client'

import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useIntl } from 'react-intl'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'

const SUGGESTION_POPUP = '[data-editor-suggestion-popup]'

/**
 * Esc while an editor suggestion popup is open closes the popup, not the
 * dialog. Keeping the dialog open means cancelling the key event, and
 * ProseMirror ignores cancelled bubbling events — so the popup would never see
 * it. Re-send the key to the editor as a non-bubbling event, which ProseMirror
 * accepts even when cancelled (and which this handler then only cancels).
 */
export function handleEscapeKeyDown(event: KeyboardEvent) {
  if (!document.querySelector(SUGGESTION_POPUP)) return
  event.preventDefault()
  if (!event.bubbles || !(event.target instanceof HTMLElement)) return
  event.target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: event.key,
      bubbles: false,
      cancelable: true,
    })
  )
}

interface FormDialogProps {
  isOpen: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode | ((expanded: boolean) => ReactNode)
  footer?: ReactNode
  expandable?: boolean
  /** Field focused on open, caret placed at the end. Without it Radix focuses
   *  the first tabbable element (the header's expand button) and, for a text
   *  input, selects its whole value — so a pre-filled title would be wiped by
   *  the first keystroke. */
  initialFocusRef?: RefObject<HTMLInputElement | null>
}

/**
 * Create-form layout (header with expand/close, scrolling body, footer bar)
 * composed on the shared shadcn Dialog, so overlay, focus trap, Esc /
 * overlay-click dismissal and focus return come from the one primitive.
 */
export function FormDialog({
  isOpen,
  onClose,
  title,
  children,
  footer,
  expandable = true,
  initialFocusRef,
}: FormDialogProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)
  // layoutExpanded lags behind on collapse: only flips false after the animation ends
  // so children's flex layout doesn't reflow mid-animation (causing the selector jump).
  const [layoutExpanded, setLayoutExpanded] = useState(false)

  // Radix returns focus only to a <DialogTrigger>. These dialogs are opened
  // from sidebar buttons, menus and shortcuts instead, so remember what had
  // focus when the dialog opened (layout effect: before Radix moves focus
  // into the content) and hand it back on close.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (isOpen && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement
    }
  }, [isOpen])

  const handleToggleExpand = () => {
    if (!expanded) {
      setLayoutExpanded(true)
      setExpanded(true)
    } else {
      setExpanded(false)
      // layoutExpanded → false deferred to onAnimationComplete
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={event => {
          const el = initialFocusRef?.current
          if (!el) return
          event.preventDefault()
          el.focus()
          el.setSelectionRange(el.value.length, el.value.length)
        }}
        // The description editor's mention / slash popup is portaled to
        // <body>, outside this dialog. Esc or a click there belongs to the
        // editor (close the popup / pick an item), not to the dialog.
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={event => {
          const target = event.target
          if (target instanceof Element && target.closest(SUGGESTION_POPUP)) {
            event.preventDefault()
          }
        }}
        onCloseAutoFocus={event => {
          const el = returnFocusRef.current
          if (!el?.isConnected) return
          event.preventDefault()
          el.focus()
        }}
        // `max-w-[860px]` is deliberately unprefixed: a `sm:` width does not
        // out-cascade the base `max-w-lg` DialogContent ships with.
        className='flex max-h-[90vh] w-[calc(100%-2rem)] max-w-[860px] flex-col gap-0 overflow-hidden rounded-xl bg-card p-0 sm:rounded-xl'
      >
        {/* Header */}
        <div className='px-6 py-4 flex items-center justify-between border-b border-border shrink-0'>
          <DialogTitle className='text-lg font-semibold leading-7 tracking-normal text-foreground'>
            {title}
          </DialogTitle>
          <div className='flex items-center gap-1'>
            {expandable && (
              <Button
                variant='ghost'
                size='icon'
                onClick={handleToggleExpand}
                className='h-7 w-7 text-muted-foreground hover:text-foreground'
                title={intl.formatMessage({
                  id: expanded ? 'formDialog.collapse' : 'formDialog.expand',
                })}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </Button>
            )}
            <DialogClose asChild>
              <Button
                variant='ghost'
                size='icon'
                className='h-7 w-7 text-muted-foreground hover:text-foreground'
                aria-label={intl.formatMessage({ id: 'common.close' })}
              >
                <X size={18} />
              </Button>
            </DialogClose>
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
      </DialogContent>
    </Dialog>
  )
}
