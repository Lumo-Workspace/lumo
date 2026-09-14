'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { API } from '../constants'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface GitHubStatus {
  connected: boolean
  githubLogin?: string
  githubUserId?: string
  repositories?: string[]
}

interface UseGitHubIntegrationReturn {
  status: GitHubStatus | null
  loading: boolean
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleConnect: () => void
  handleDisconnect: () => Promise<void>
}

export function useGitHubIntegration(
  workspaceUrl: string
): UseGitHubIntegrationReturn {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const statusKey = queryKeys.integrations.github(workspaceUrl)

  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const statusQuery = useQuery<GitHubStatus>({
    queryKey: statusKey,
    queryFn: () =>
      apiFetch<GitHubStatus>(
        `${API.github.integration}?workspaceUrl=${workspaceUrl}`
      ),
  })

  const disconnectMutation = useMutation<void, Error>({
    mutationFn: () =>
      apiFetch<void>(`${API.github.integration}?workspaceUrl=${workspaceUrl}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.setQueryData<GitHubStatus>(statusKey, { connected: false })
      toast.success(intl.formatMessage({ id: 'github.disconnectSuccess' }))
    },
    onError: () => {
      toast.error(intl.formatMessage({ id: 'github.disconnectFailed' }))
    },
    onSettled: () => {
      setDisconnectOpen(false)
    },
  })

  const handleConnect = () => {
    window.open(API.github.oauth(workspaceUrl), '_blank')
  }

  const handleDisconnect = async () => {
    await disconnectMutation.mutateAsync()
  }

  return {
    status: statusQuery.data ?? null,
    loading: statusQuery.isLoading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    handleConnect,
    handleDisconnect,
  }
}
