'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { API } from '../constants'
import { apiFetch } from '@/lib/api-client'

interface SlackStatus {
  connected: boolean
  slackTeamName?: string
  slackUserId?: string
  slackTeamId?: string
}

interface UseSlackIntegrationReturn {
  status: SlackStatus | null
  loading: boolean
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleConnect: () => void
  handleDisconnect: () => Promise<void>
}

export function useSlackIntegration(): UseSlackIntegrationReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const [status, setStatus] = useState<SlackStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SlackStatus>(
        API.slack.integration(workspaceUrl)
      )
      setStatus(data)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [workspaceUrl])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('slack_connected') === '1') {
      toast.success(intl.formatMessage({ id: 'slack.connectSuccess' }))
      fetchStatus()
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('slack_error') === '1') {
      toast.error(intl.formatMessage({ id: 'slack.connectFailed' }))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [fetchStatus, intl])

  const handleConnect = useCallback(() => {
    window.open(API.slack.oauth(workspaceUrl), '_blank')
  }, [workspaceUrl])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await apiFetch<void>(API.slack.integration(workspaceUrl), {
        method: 'DELETE',
      })
      setStatus({ connected: false })
      toast.success(intl.formatMessage({ id: 'slack.disconnectSuccess' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'slack.disconnectFailed' }))
    } finally {
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }

  return {
    status,
    loading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleConnect,
    handleDisconnect,
  }
}
