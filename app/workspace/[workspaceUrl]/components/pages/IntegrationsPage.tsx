'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { GitHubIntegrationCard } from '../GitHubIntegrationCard'
import { API } from '../../constants'

export interface GitHubStatus {
  connected: boolean
  githubLogin?: string
  githubUserId?: string
  repositories?: string[]
}

export function IntegrationsPage() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Handle error redirect from OAuth callback
    const params = new URLSearchParams(window.location.search)
    if (params.get('github_error')) {
      toast.error('GitHub connection failed. Please try again.')
      window.history.replaceState({}, '', window.location.pathname)
    }

    fetch(`${API.github.integration}?workspaceUrl=${workspaceUrl}`)
      .then(r => r.json())
      .then(setGhStatus)
      .catch(() => toast.error('Failed to load integrations'))
      .finally(() => setLoading(false))
  }, [workspaceUrl])

  return (
    <div className='flex-1 overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-8 py-10'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          Integrations
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          Connect external services to enhance your workflow.
        </p>

        {loading ? (
          <div className='h-32 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse bg-zinc-50 dark:bg-zinc-900' />
        ) : (
          <GitHubIntegrationCard
            workspaceUrl={workspaceUrl}
            status={ghStatus}
            onStatusChange={setGhStatus}
          />
        )}
      </div>
    </div>
  )
}
