'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ArrowUpRight, RefreshCw, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { lumoSyncClient } from '@/lib/api-client/lumo-sync'
import { SyncLumoPreviewDialog } from '../SyncLumoPreviewDialog'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

type SyncState = 'idle' | 'generating' | 'previewing' | 'syncing' | 'done'

interface ProposalPreview {
  id: string
  operations: ProposalOperation[]
  summary: string
}

interface SyncLumoBannerProps {
  taskId: string
  memoryCount: number
}

export function SyncLumoBanner({ taskId, memoryCount }: SyncLumoBannerProps) {
  const intl = useIntl()
  const [state, setState] = useState<SyncState>('idle')
  const [proposal, setProposal] = useState<ProposalPreview | null>(null)
  const [prUrl, setPrUrl] = useState<string | null>(null)

  if (state === 'done' && prUrl) {
    return (
      <div className='flex items-center justify-between rounded-lg border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-950/30 px-4 py-3'>
        <div className='flex items-center gap-2 text-sm text-green-700 dark:text-green-400'>
          <Check size={14} />
          {intl.formatMessage({ id: 'lumo.sync.banner.synced' })}
        </div>
        <a
          href={prUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 hover:underline'
        >
          {intl.formatMessage({ id: 'lumo.sync.banner.viewPr' })}
          <ArrowUpRight size={12} />
        </a>
      </div>
    )
  }

  if (memoryCount === 0) return null

  async function handleGenerate() {
    setState('generating')
    try {
      const result = await lumoSyncClient.generateProposal(taskId)
      setProposal(result)
      setState('previewing')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : intl.formatMessage({ id: 'lumo.sync.generateFailed' })
      )
      setState('idle')
    }
  }

  async function handleConfirm() {
    if (!proposal) return
    setState('syncing')
    try {
      const result = await lumoSyncClient.sync(proposal.id)
      toast.success(intl.formatMessage({ id: 'lumo.sync.prCreated' }))
      setPrUrl(result.prUrl)
      setState('done')
      setProposal(null)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : intl.formatMessage({ id: 'lumo.sync.syncFailed' })
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
      <div className='flex items-center justify-between rounded-lg border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-950/30 px-4 py-3'>
        <p className='text-sm text-violet-700 dark:text-violet-300'>
          {intl.formatMessage(
            { id: 'lumo.sync.banner.ready' },
            { n: memoryCount }
          )}
        </p>
        <button
          onClick={handleGenerate}
          disabled={state === 'generating'}
          className='flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
        >
          {state === 'generating' ? (
            <>
              <Loader2 size={12} className='animate-spin' />
              {intl.formatMessage({ id: 'lumo.sync.generating' })}
            </>
          ) : (
            <>
              <RefreshCw size={12} />
              {intl.formatMessage(
                { id: 'lumo.sync.banner.button' },
                { n: memoryCount }
              )}
            </>
          )}
        </button>
      </div>

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
