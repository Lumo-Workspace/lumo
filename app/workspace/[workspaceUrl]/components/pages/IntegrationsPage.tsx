'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import { GitHubIntegrationCard } from '../GitHubIntegrationCard'
import { SlackIntegrationCard } from '../SlackIntegrationCard'
import { SentryIntegrationCard } from '../SentryIntegrationCard'
import { FigmaIntegrationCard } from '../FigmaIntegrationCard'
import { API } from '../../constants'
import { apiFetch } from '@/lib/api-client'

export interface GitHubStatus {
  connected: boolean
  githubLogin?: string
  githubUserId?: string
  repositories?: string[]
}

export function IntegrationsPage({ isOwner }: { isOwner: boolean }) {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Handle error redirect from OAuth callback
    const params = new URLSearchParams(window.location.search)
    if (params.get('github_error')) {
      toast.error(intl.formatMessage({ id: 'github.connectFailed' }))
      window.history.replaceState({}, '', window.location.pathname)
    }

    const loadStatus = async () => {
      try {
        const data = await apiFetch<GitHubStatus>(
          `${API.github.integration}?workspaceUrl=${workspaceUrl}`
        )
        setGhStatus(data)
      } catch {
        toast.error(intl.formatMessage({ id: 'github.loadFailed' }))
      } finally {
        setLoading(false)
      }
    }
    loadStatus()
  }, [workspaceUrl])

  return (
    <div className='flex-1 overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-8 py-10'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          {intl.formatMessage({ id: 'integrations.title' })}
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          {intl.formatMessage({ id: 'integrations.description' })}
        </p>

        {loading ? (
          <div className='h-32 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse bg-zinc-50 dark:bg-zinc-900' />
        ) : (
          <div className='space-y-4'>
            <GitHubIntegrationCard
              workspaceUrl={workspaceUrl}
              status={ghStatus}
              onStatusChange={setGhStatus}
              isOwner={isOwner}
            />
            <SlackIntegrationCard isOwner={isOwner} />
            <SentryIntegrationCard isOwner={isOwner} />
            <FigmaIntegrationCard />
          </div>
        )}
      </div>
    </div>
  )
}
