'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import { workspacesClient } from '@/lib/api-client'

/** The core columns the settings pages read; plugin-owned ones pass through (LUM-1062). */
export type OwnerWorkspace = {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  defaultLocale?: string
  hookEventRetentionDays?: number | null
  hookEventRetentionMode?: string
  crossingRawRetentionDays?: number
  deadLetterRetentionDays?: number
  aiDerivedContentEnabled?: boolean
  doneRequiresTestCase?: boolean
  doneRequiresReview?: boolean
} & { [column: string]: unknown }

type WorkspaceCache = {
  name?: string
  logoUrl?: string | null
  slug?: string
  role?: string
}

/** Merge new fields into the workspace cache without clobbering unrelated keys
 *  (e.g. name/logoUrl written by Sidebar.tsx). */
export function patchWorkspaceCache(patch: Partial<WorkspaceCache>) {
  const prev = readCache<WorkspaceCache>(CACHE_KEY.workspace) ?? {}
  writeCache(CACHE_KEY.workspace, { ...prev, ...patch })
}

export interface UseOwnerWorkspaceReturn {
  workspace: OwnerWorkspace | null
  setWorkspace: React.Dispatch<React.SetStateAction<OwnerWorkspace | null>>
  /** The whole GET /api/workspaces/me response, for plugin settings slots. */
  me: Record<string, unknown>
  isOwner: boolean
  loading: boolean
  /** The real (not cache-hydrated) row is in and the viewer is the OWNER. */
  loaded: boolean
}

/**
 * LUM-1339 — the OWNER-only settings pages' shared load: the workspace row
 * from GET /api/workspaces/me, painted from the cache first, and a redirect
 * to Members for anyone else (the API enforces 403 on every write too).
 * Lifted unchanged from the old single Workspace page.
 */
export function useOwnerWorkspace(): UseOwnerWorkspaceReturn {
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const [workspace, setWorkspace] = useState<OwnerWorkspace | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<Record<string, unknown>>({})

  // Hydrate from cache immediately (stale-while-revalidate).
  useEffect(() => {
    const cached = readCache<WorkspaceCache>(CACHE_KEY.workspace)
    if (cached?.name && cached?.slug) {
      const owner = cached.role === 'OWNER'
      setWorkspace({
        id: '',
        name: cached.name,
        slug: cached.slug,
        logoUrl: cached.logoUrl ?? null,
      })
      setIsOwner(owner)
      setLoading(false)
      if (!owner && cached.role) {
        router.replace(`/workspace/${workspaceUrl}/settings/members`)
      }
    }
  }, [])

  const fetchWorkspace = useCallback(async () => {
    try {
      const data = await workspacesClient.getMe<
        { workspace: OwnerWorkspace; role: string } & Record<string, unknown>
      >()
      const owner = data.role === 'OWNER'
      setWorkspace(data.workspace)
      setMe(data)
      setIsOwner(owner)
      patchWorkspaceCache({
        name: data.workspace.name,
        slug: data.workspace.slug,
        role: data.role,
      })
      if (!owner) {
        router.replace(`/workspace/${workspaceUrl}/settings/members`)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkspace()
  }, [fetchWorkspace])

  return {
    workspace,
    setWorkspace,
    me,
    isOwner,
    loading,
    loaded: isOwner && Boolean(workspace?.id),
  }
}
