'use client'

import { useState, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { API } from '../constants'
import type { GitHubStatus } from '../components/pages/IntegrationsPage'

interface GhRepo {
  fullName: string
  name: string
  private: boolean
}

interface UseGitHubIntegrationReturn {
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  addRepoOpen: boolean
  setAddRepoOpen: (open: boolean) => void
  availableRepos: GhRepo[]
  loadingRepos: boolean
  handleConnect: () => void
  handleDisconnect: () => Promise<void>
  handleRemoveRepo: (repo: string) => Promise<void>
  openAddRepo: () => Promise<void>
  handleAddRepo: (fullName: string) => Promise<void>
}

export function useGitHubIntegration(
  workspaceUrl: string,
  status: GitHubStatus | null,
  onStatusChange: (status: GitHubStatus) => void
): UseGitHubIntegrationReturn {
  const intl = useIntl()
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [availableRepos, setAvailableRepos] = useState<GhRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)

  const handleConnect = useCallback(() => {
    window.open(API.github.oauth(workspaceUrl), '_blank')
  }, [workspaceUrl])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch(
        `${API.github.integration}?workspaceUrl=${workspaceUrl}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error()
      onStatusChange({ connected: false })
      toast.success(intl.formatMessage({ id: 'github.disconnectSuccess' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'github.disconnectFailed' }))
    } finally {
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }

  const handleRemoveRepo = async (repo: string) => {
    if (!status?.repositories) return
    const updated = status.repositories.filter(r => r !== repo)
    try {
      const res = await fetch(
        `${API.github.repos}?workspaceUrl=${workspaceUrl}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repositories: updated }),
        }
      )
      if (!res.ok) throw new Error()
      onStatusChange({ ...status, repositories: updated })
    } catch {
      toast.error(intl.formatMessage({ id: 'github.removeRepoFailed' }))
    }
  }

  const openAddRepo = async () => {
    setAddRepoOpen(true)
    setLoadingRepos(true)
    try {
      const res = await fetch(
        `${API.github.repos}?workspaceUrl=${workspaceUrl}`
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setAvailableRepos(data.repos ?? [])
    } catch {
      toast.error(intl.formatMessage({ id: 'github.loadReposFailed' }))
      setAddRepoOpen(false)
    } finally {
      setLoadingRepos(false)
    }
  }

  const handleAddRepo = async (fullName: string) => {
    if (!status) return
    const current = status.repositories ?? []
    if (current.includes(fullName)) return
    const updated = [...current, fullName]
    try {
      const res = await fetch(
        `${API.github.repos}?workspaceUrl=${workspaceUrl}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repositories: updated }),
        }
      )
      if (!res.ok) throw new Error()
      onStatusChange({ ...status, repositories: updated })
      setAddRepoOpen(false)
      toast.success(
        intl.formatMessage({ id: 'github.addRepoSuccess' }, { name: fullName })
      )
    } catch {
      toast.error(intl.formatMessage({ id: 'github.addRepoFailed' }))
    }
  }

  return {
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    addRepoOpen,
    setAddRepoOpen,
    availableRepos,
    loadingRepos,
    handleConnect,
    handleDisconnect,
    handleRemoveRepo,
    openAddRepo,
    handleAddRepo,
  }
}
