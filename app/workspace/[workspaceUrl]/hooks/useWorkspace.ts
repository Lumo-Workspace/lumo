'use client'

import { useQuery } from '@tanstack/react-query'
import { workspacesClient } from '@/lib/api-client/workspaces'
import { queryKeys } from '@/lib/query/keys'
import { CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'

/**
 * Workspace metadata shared across the app shell.
 *
 * All fields are optional: the placeholder served from localStorage on first
 * paint only carries name/logo/slug, and risk fields are absent on workspaces
 * that never customised their defaults — consumers apply their own fallbacks.
 */
export interface WorkspaceMeta {
  id?: string
  name?: string
  slug?: string
  logoUrl?: string | null
  riskOverdueRatio?: number
  riskStalledDays?: number
  riskStalledMinCount?: number
  riskAgentFailRatio?: number
  riskStalePrDays?: number
  riskThroughputDrop?: number
}

/** Subset of WorkspaceMeta persisted to localStorage for instant first paint. */
type WorkspaceCache = {
  name?: string
  logoUrl?: string | null
  slug?: string
  role?: string
}

const STALE_TIME_MS = 10 * 60 * 1000 // ~10min — workspace metadata changes rarely

/**
 * Cache the current workspace's metadata (name / logo / risk defaults) in a
 * single React Query entry so every page shares one fetch instead of each
 * mounting its own `getMe()` effect (the Sidebar used to re-fetch on every
 * navigation). `staleTime` keeps it fresh for ~10min; the localStorage warm
 * value is served as a placeholder so the Sidebar header paints without a
 * name/logo flicker across full reloads (React Query's cache is in-memory).
 */
export function useWorkspace() {
  const query = useQuery<WorkspaceMeta>({
    queryKey: queryKeys.workspace(),
    queryFn: async () => {
      const data = await workspacesClient.getMe<{ workspace?: WorkspaceMeta }>()
      const ws = data?.workspace ?? {}
      // Persist the paint-critical fields for the next reload. Merge so we don't
      // clobber keys written by other call sites (e.g. settings' role/slug).
      const prev = readCache<WorkspaceCache>(CACHE_KEY.workspace) ?? {}
      writeCache(CACHE_KEY.workspace, {
        ...prev,
        name: ws.name,
        logoUrl: ws.logoUrl,
        slug: ws.slug,
      })
      return ws
    },
    staleTime: STALE_TIME_MS,
    placeholderData: () => {
      const cached = readCache<WorkspaceCache>(CACHE_KEY.workspace)
      if (!cached || (!cached.name && cached.logoUrl == null)) return undefined
      // Build without undefined-valued keys (exactOptionalPropertyTypes).
      const placeholder: WorkspaceMeta = {}
      if (cached.name !== undefined) placeholder.name = cached.name
      if (cached.logoUrl !== undefined) placeholder.logoUrl = cached.logoUrl
      if (cached.slug !== undefined) placeholder.slug = cached.slug
      return placeholder
    },
  })

  return {
    workspace: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    /** True while serving the localStorage warm value (no real fetch yet).
     *  The placeholder carries name/logo only — no risk defaults. */
    isPlaceholder: query.isPlaceholderData,
  }
}
