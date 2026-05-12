'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { lumoSyncClient } from '@/lib/api-client/lumo-sync'
import { SyncLumoPreviewDialog } from './SyncLumoPreviewDialog'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

type SyncState = 'idle' | 'generating' | 'previewing' | 'syncing'

interface ProposalPreview {
  id: string
  operations: ProposalOperation[]
  summary: string
}

interface SyncLumoButtonProps {
  taskId: string
}

export function SyncLumoButton({ taskId }: SyncLumoButtonProps) {
  const [state, setState] = useState<SyncState>('idle')
  const [proposal, setProposal] = useState<ProposalPreview | null>(null)

  async function handleGenerate() {
    setState('generating')
    try {
      const result = await lumoSyncClient.generateProposal(taskId)
      setProposal(result)
      setState('previewing')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate proposal'
      )
      setState('idle')
    }
  }

  async function handleConfirm() {
    if (!proposal) return
    setState('syncing')
    try {
      const result = await lumoSyncClient.sync(proposal.id)
      toast.success('PR created successfully')
      window.open(result.prUrl, '_blank')
      setState('idle')
      setProposal(null)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create PR'
      )
      setState('previewing')
    }
  }

  function handleCancel() {
    setState('idle')
    setProposal(null)
  }

  return (
    <>
      <button
        onClick={handleGenerate}
        disabled={state !== 'idle'}
        className='w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
      >
        <RefreshCw
          size={12}
          className={state === 'generating' ? 'animate-spin' : ''}
        />
        {state === 'generating' ? 'Generating proposal...' : 'Sync to LUMO.md'}
      </button>

      <SyncLumoPreviewDialog
        open={state === 'previewing' || state === 'syncing'}
        proposal={proposal}
        syncing={state === 'syncing'}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  )
}
