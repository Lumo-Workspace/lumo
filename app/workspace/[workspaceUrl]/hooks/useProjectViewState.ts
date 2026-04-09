'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { ApiRepository } from '../types'

interface UseProjectViewStateParams {
  projectId: string
  initialRepositories: ApiRepository[] | undefined
  workspaceUrl: string
}

export function useProjectViewState({
  projectId,
  initialRepositories,
  workspaceUrl,
}: UseProjectViewStateParams) {
  const [tab, setTab] = useState<'overview' | 'tasks' | 'summary'>('overview')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ── Repositories state ──────────────────────────────────────────────────
  const [repositories, setRepositories] = useState<ApiRepository[]>(
    initialRepositories ?? []
  )
  // Sync when parent hydrates repositories from the API (standalone page flow)
  useEffect(() => {
    if (initialRepositories) setRepositories(initialRepositories)
  }, [initialRepositories])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [availableRepos, setAvailableRepos] = useState<
    { fullName: string; private: boolean }[]
  >([])
  const [reposLoading, setReposLoading] = useState(false)
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const [addingRepo, setAddingRepo] = useState<string | null>(null)

  // Fetch available repos from GitHub when picker opens
  useEffect(() => {
    if (!pickerOpen) return
    setReposLoading(true)
    apiFetch<{ repos?: { fullName: string; private: boolean }[] }>(
      `/api/github/repos?workspaceUrl=${workspaceUrl}`
    )
      .then(data => {
        if (data.repos) {
          setAvailableRepos(data.repos)
          setGithubConnected(true)
        } else {
          setGithubConnected(false)
        }
      })
      .catch(() => setGithubConnected(false))
      .finally(() => setReposLoading(false))
  }, [pickerOpen, workspaceUrl])

  const linkedFullNames = useMemo(
    () => new Set(repositories.map(r => r.fullName)),
    [repositories]
  )

  const handleAddRepo = useCallback(
    async (fullName: string) => {
      if (linkedFullNames.has(fullName)) return
      setAddingRepo(fullName)
      try {
        const data = await apiFetch<{ repository: ApiRepository }>(
          `/api/projects/${projectId}/repositories`,
          {
            method: 'POST',
            body: { fullName },
          }
        )
        setRepositories(prev => [...prev, data.repository])
        setPickerOpen(false)
      } finally {
        setAddingRepo(null)
      }
    },
    [projectId, linkedFullNames]
  )

  const handleSetDefault = useCallback(
    async (repoId: string) => {
      try {
        await apiFetch(`/api/projects/${projectId}/repositories/${repoId}`, {
          method: 'PATCH',
          body: { isDefault: true },
        })
        setRepositories(prev =>
          prev.map(r => ({ ...r, isDefault: r.id === repoId }))
        )
      } catch {
        // ignore
      }
    },
    [projectId]
  )

  const handleRemoveRepo = useCallback(
    async (repoId: string) => {
      try {
        await apiFetch(`/api/projects/${projectId}/repositories/${repoId}`, {
          method: 'DELETE',
        })
        setRepositories(prev => prev.filter(r => r.id !== repoId))
      } catch {
        // ignore
      }
    },
    [projectId]
  )

  return {
    // Tab & view
    tab,
    setTab,
    viewMode,
    setViewMode,
    deleteOpen,
    setDeleteOpen,
    // Repos
    repositories,
    pickerOpen,
    setPickerOpen,
    availableRepos,
    reposLoading,
    githubConnected,
    addingRepo,
    linkedFullNames,
    handleAddRepo,
    handleSetDefault,
    handleRemoveRepo,
  }
}
