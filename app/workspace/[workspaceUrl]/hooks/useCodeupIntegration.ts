'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { codeupApi, type CodeupStatus } from '@/lib/api-client/codeup'
import { queryKeys } from '@/lib/query/keys'

interface UseCodeupIntegrationReturn {
  status: CodeupStatus | null
  loading: boolean
  connectOpen: boolean
  setConnectOpen: (open: boolean) => void
  repositoriesOpen: boolean
  setRepositoriesOpen: (open: boolean) => void
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleDisconnect: () => Promise<void>
  refreshStatus: () => Promise<void>
}

/** LUM-1315 — state for the Codeup settings card. */
export function useCodeupIntegration(): UseCodeupIntegrationReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.codeup(workspaceUrl)

  const [connectOpen, setConnectOpen] = useState(false)
  const [repositoriesOpen, setRepositoriesOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const query = useQuery<CodeupStatus>({
    queryKey,
    queryFn: () => codeupApi.getStatus(workspaceUrl),
    retry: false,
  })

  const disconnectMutation = useMutation<unknown, Error, void>({
    mutationFn: () => codeupApi.disconnect(workspaceUrl),
    onSuccess: () => {
      queryClient.setQueryData<CodeupStatus>(queryKey, { connected: false })
      toast.success(intl.formatMessage({ id: 'codeup.disconnectSuccess' }))
    },
    onError: () => {
      toast.error(intl.formatMessage({ id: 'codeup.disconnectFailed' }))
    },
    onSettled: () => {
      setDisconnectOpen(false)
    },
  })

  const refreshStatus = async () => {
    await queryClient.invalidateQueries({ queryKey })
  }

  const handleDisconnect = async () => {
    try {
      await disconnectMutation.mutateAsync()
    } catch {
      // Already reported by the mutation's onError toast.
    }
  }

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    connectOpen,
    setConnectOpen,
    repositoriesOpen,
    setRepositoriesOpen,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    handleDisconnect,
    refreshStatus,
  }
}
