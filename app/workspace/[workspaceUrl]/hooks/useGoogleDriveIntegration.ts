'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  googleDriveApi,
  type GoogleDriveIntegrationStatus,
} from '@/lib/api-client/google-drive'
import { queryKeys } from '@/lib/query/keys'

interface UseGoogleDriveIntegrationReturn {
  status: GoogleDriveIntegrationStatus | null
  loading: boolean
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleDisconnect: () => Promise<void>
}

export function useGoogleDriveIntegration(): UseGoogleDriveIntegrationReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.googleDrive(workspaceUrl)

  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const query = useQuery<GoogleDriveIntegrationStatus>({
    queryKey,
    queryFn: () => googleDriveApi.getStatus(),
    retry: false,
  })

  const disconnectMutation = useMutation<unknown, Error>({
    mutationFn: () => googleDriveApi.disconnect(),
    onSuccess: () => {
      queryClient.setQueryData<GoogleDriveIntegrationStatus>(queryKey, {
        connected: false,
      })
      toast.success(intl.formatMessage({ id: 'googleDrive.disconnectSuccess' }))
    },
    onError: () => {
      toast.error(intl.formatMessage({ id: 'googleDrive.disconnectFailed' }))
    },
    onSettled: () => {
      setDisconnectOpen(false)
    },
  })

  // OAuth callback param handling — fires once on mount when returning from
  // the Google OAuth round-trip with ?connected=1 or ?google_error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_connected') === '1') {
      toast.success(intl.formatMessage({ id: 'googleDrive.connectSuccess' }))
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.googleDrive(workspaceUrl),
      })
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('google_error')) {
      toast.error(intl.formatMessage({ id: 'googleDrive.connectFailed' }))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [workspaceUrl, intl, queryClient])

  const handleDisconnect = async () => {
    await disconnectMutation.mutateAsync()
  }

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    handleDisconnect,
  }
}
