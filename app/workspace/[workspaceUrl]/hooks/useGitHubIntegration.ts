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

interface GhRepo {
  fullName: string
  name: string
  private: boolean
}

interface UseGitHubIntegrationReturn {
  status: GitHubStatus | null
  loading: boolean
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
  workspaceUrl: string
): UseGitHubIntegrationReturn {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const statusKey = queryKeys.integrations.github(workspaceUrl)
  const reposKey = queryKeys.integrations.githubRepos(workspaceUrl)

  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)

  const statusQuery = useQuery<GitHubStatus>({
    queryKey: statusKey,
    queryFn: () =>
      apiFetch<GitHubStatus>(
        `${API.github.integration}?workspaceUrl=${workspaceUrl}`
      ),
  })

  // Available repos load on demand via refetch() in openAddRepo so errors can
  // be handled inline without a useEffect-driven cascade.
  const reposQuery = useQuery<GhRepo[]>({
    queryKey: reposKey,
    queryFn: async () => {
      const data = await apiFetch<{ repos?: GhRepo[] }>(
        `${API.github.repos}?workspaceUrl=${workspaceUrl}`
      )
      return data.repos ?? []
    },
    enabled: false,
  })

  const disconnectMutation = useMutation<void, Error>({
    mutationFn: () =>
      apiFetch<void>(
        `${API.github.integration}?workspaceUrl=${workspaceUrl}`,
        { method: 'DELETE' }
      ),
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

  const removeRepoMutation = useMutation<
    void,
    Error,
    string,
    { prev: GitHubStatus | undefined }
  >({
    mutationFn: async repo => {
      const prev = queryClient.getQueryData<GitHubStatus>(statusKey)
      const updated = (prev?.repositories ?? []).filter(r => r !== repo)
      await apiFetch<void>(`${API.github.repos}?workspaceUrl=${workspaceUrl}`, {
        method: 'PATCH',
        body: { repositories: updated },
      })
    },
    onMutate: async repo => {
      await queryClient.cancelQueries({ queryKey: statusKey })
      const prev = queryClient.getQueryData<GitHubStatus>(statusKey)
      queryClient.setQueryData<GitHubStatus>(statusKey, current =>
        current
          ? {
              ...current,
              repositories: (current.repositories ?? []).filter(r => r !== repo),
            }
          : current
      )
      return { prev }
    },
    onError: (_err, _repo, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(statusKey, context.prev)
      }
      toast.error(intl.formatMessage({ id: 'github.removeRepoFailed' }))
    },
  })

  const addRepoMutation = useMutation<
    void,
    Error,
    string,
    { prev: GitHubStatus | undefined }
  >({
    mutationFn: async fullName => {
      const current = queryClient.getQueryData<GitHubStatus>(statusKey)
      const repos = current?.repositories ?? []
      if (repos.includes(fullName)) return
      const updated = [...repos, fullName]
      await apiFetch<void>(`${API.github.repos}?workspaceUrl=${workspaceUrl}`, {
        method: 'PATCH',
        body: { repositories: updated },
      })
    },
    onMutate: async fullName => {
      await queryClient.cancelQueries({ queryKey: statusKey })
      const prev = queryClient.getQueryData<GitHubStatus>(statusKey)
      queryClient.setQueryData<GitHubStatus>(statusKey, current => {
        if (!current) return current
        const repos = current.repositories ?? []
        if (repos.includes(fullName)) return current
        return { ...current, repositories: [...repos, fullName] }
      })
      return { prev }
    },
    onSuccess: (_data, fullName) => {
      setAddRepoOpen(false)
      toast.success(
        intl.formatMessage({ id: 'github.addRepoSuccess' }, { name: fullName })
      )
    },
    onError: (_err, _fullName, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(statusKey, context.prev)
      }
      toast.error(intl.formatMessage({ id: 'github.addRepoFailed' }))
    },
  })

  const handleConnect = () => {
    window.open(API.github.oauth(workspaceUrl), '_blank')
  }

  const handleDisconnect = async () => {
    await disconnectMutation.mutateAsync()
  }

  const handleRemoveRepo = async (repo: string) => {
    await removeRepoMutation.mutateAsync(repo)
  }

  const openAddRepo = async () => {
    setAddRepoOpen(true)
    const result = await reposQuery.refetch()
    if (result.isError) {
      toast.error(intl.formatMessage({ id: 'github.loadReposFailed' }))
      setAddRepoOpen(false)
    }
  }

  const handleAddRepo = async (fullName: string) => {
    await addRepoMutation.mutateAsync(fullName)
  }

  return {
    status: statusQuery.data ?? null,
    loading: statusQuery.isLoading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    addRepoOpen,
    setAddRepoOpen,
    availableRepos: reposQuery.data ?? [],
    loadingRepos: reposQuery.isFetching,
    handleConnect,
    handleDisconnect,
    handleRemoveRepo,
    openAddRepo,
    handleAddRepo,
  }
}
