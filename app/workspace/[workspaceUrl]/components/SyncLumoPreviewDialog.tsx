'use client'

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

interface ProposalPreview {
  id: string
  operations: ProposalOperation[]
  summary: string
}

const BADGE_STYLES: Record<string, string> = {
  add: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  modify:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  supersede:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

function OperationBadge({ type }: { type: string }) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${BADGE_STYLES[type] ?? ''}`}
    >
      {type}
    </span>
  )
}

function getOperationContent(op: ProposalOperation): string {
  if (op.type === 'modify') return op.newContent
  return op.content
}

interface SyncLumoPreviewDialogProps {
  open: boolean
  proposal: ProposalPreview | null
  syncing: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function SyncLumoPreviewDialog({
  open,
  proposal,
  syncing,
  onConfirm,
  onCancel,
}: SyncLumoPreviewDialogProps) {
  if (!proposal) return null

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Sync to LUMO.md</DialogTitle>
        </DialogHeader>

        <div className='space-y-3'>
          <p className='text-sm text-zinc-600 dark:text-zinc-400'>
            {proposal.summary}
          </p>

          <div className='space-y-2 max-h-64 overflow-y-auto'>
            {proposal.operations.map((op, i) => (
              <div
                key={i}
                className='rounded-md border border-zinc-100 dark:border-zinc-800 p-3 space-y-1.5'
              >
                <div className='flex items-center gap-2'>
                  <OperationBadge type={op.type} />
                  <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
                    {op.section}
                  </span>
                </div>
                <p className='text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2'>
                  {getOperationContent(op)}
                </p>
                <p className='text-[11px] text-zinc-400 dark:text-zinc-500 italic'>
                  {op.rationale}
                </p>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onCancel} disabled={syncing}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 size={14} className='animate-spin mr-1.5' />
                Creating PR...
              </>
            ) : (
              'Confirm & Create PR'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
