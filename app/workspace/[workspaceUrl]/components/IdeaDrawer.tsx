'use client'

import { useIntl } from 'react-intl'
import { Drawer as DrawerPrimitive } from 'vaul'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiIdea } from '../types'
import { IdeaDetailPanel } from './IdeaDetailPanel'

interface IdeaDrawerProps {
  idea: ApiIdea
  workspaceUrl: string
  onClose: () => void
  onSave: (statement: string) => Promise<void>
  saving?: boolean
}

/**
 * Right-hand slide-over hosting the idea detail (LUM-683). Mirrors `TaskDrawer`
 * (same vaul primitive, direction, overlay + escape handling) so the idea pool
 * gets the same lightweight detail affordance as tasks. The task chose the
 * slide-over over a dedicated `/ideas/[id]` page ("倾向 slide-over 更轻"); the
 * body is the shared `IdeaDetailPanel`.
 */
export function IdeaDrawer({
  idea,
  workspaceUrl,
  onClose,
  onSave,
  saving,
}: IdeaDrawerProps) {
  const intl = useIntl()

  return (
    <DrawerPrimitive.Root
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      direction='right'
      dismissible={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay
          className='fixed inset-0 z-overlay bg-black/10 dark:bg-black/30'
          onClick={onClose}
        />
        <DrawerPrimitive.Content
          className='fixed right-0 top-0 bottom-0 z-modal flex w-full flex-col border-l border-border bg-card shadow-elevation-3 outline-none md:w-[520px]'
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
          }}
        >
          <DrawerPrimitive.Title className='sr-only'>
            {intl.formatMessage({ id: 'ideas.detail.title' })}
          </DrawerPrimitive.Title>

          {/* Header — close only (no deep-link page for ideas) */}
          <div className='flex items-center justify-end px-5 pb-2 pt-4'>
            <Button
              variant='ghost'
              size='icon'
              onClick={onClose}
              className='h-7 w-7 text-muted-foreground hover:text-foreground'
              aria-label={intl.formatMessage({ id: 'common.close' })}
            >
              <X size={14} />
            </Button>
          </div>

          <IdeaDetailPanel
            idea={idea}
            workspaceUrl={workspaceUrl}
            onSave={onSave}
            {...(saving !== undefined ? { saving } : {})}
          />
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}
