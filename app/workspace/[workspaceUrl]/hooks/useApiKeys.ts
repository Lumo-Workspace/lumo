'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'

export interface ApiKeyRecord {
  id: string
  label: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
  scope: string | null
}

export interface NewKeyResult extends ApiKeyRecord {
  key: string // full key, shown once
}

interface UseApiKeysReturn {
  keys: ApiKeyRecord[]
  loading: boolean
  label: string
  setLabel: (label: string) => void
  creating: boolean
  newKey: NewKeyResult | null
  setNewKey: (key: NewKeyResult | null) => void
  copied: boolean
  revokeTarget: ApiKeyRecord | null
  setRevokeTarget: (target: ApiKeyRecord | null) => void
  revoking: boolean
  creatingIngest: boolean
  handleCreate: () => Promise<void>
  handleCreateIngestKey: () => Promise<void>
  handleRevoke: () => Promise<void>
  handleCopy: () => Promise<void>
}

const QUERY_KEY = ['apiKeys'] as const

export function useApiKeys(): UseApiKeysReturn {
  const intl = useIntl()
  const queryClient = useQueryClient()

  const query = useQuery<ApiKeyRecord[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      try {
        const data = await apiFetch<{ keys: ApiKeyRecord[] }>(
          '/api/users/api-keys'
        )
        return data.keys
      } catch (err) {
        toast.error(intl.formatMessage({ id: 'apiKeys.loadFailed' }))
        throw err
      }
    },
  })

  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [creatingIngest, setCreatingIngest] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!label.trim()) return
    setCreating(true)
    try {
      const result = await apiFetch<NewKeyResult>('/api/users/api-keys', {
        method: 'POST',
        body: { label: label.trim() },
      })
      setNewKey(result)
      setLabel('')
      queryClient.setQueryData<ApiKeyRecord[]>(QUERY_KEY, prev => [
        result,
        ...(prev ?? []),
      ])
    } catch {
      toast.error(intl.formatMessage({ id: 'apiKeys.createFailed' }))
    } finally {
      setCreating(false)
    }
  }, [label, intl, queryClient])

  const handleCreateIngestKey = useCallback(async () => {
    setCreatingIngest(true)
    try {
      const result = await apiFetch<NewKeyResult>('/api/users/api-keys', {
        method: 'POST',
        body: { label: 'CI ingest', scope: 'security:ingest' },
      })
      setNewKey(result)
      queryClient.setQueryData<ApiKeyRecord[]>(QUERY_KEY, prev => [
        result,
        ...(prev ?? []),
      ])
    } catch {
      toast.error(intl.formatMessage({ id: 'apiKeys.createFailed' }))
    } finally {
      setCreatingIngest(false)
    }
  }, [intl, queryClient])

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await apiFetch<void>(`/api/users/api-keys/${revokeTarget.id}`, {
        method: 'DELETE',
      })
      queryClient.setQueryData<ApiKeyRecord[]>(QUERY_KEY, prev =>
        (prev ?? []).filter(k => k.id !== revokeTarget.id)
      )
      toast.success(intl.formatMessage({ id: 'apiKeys.revokeSuccess' }))
      setRevokeTarget(null)
    } catch {
      toast.error(intl.formatMessage({ id: 'apiKeys.revokeFailed' }))
    } finally {
      setRevoking(false)
    }
  }, [revokeTarget, intl, queryClient])

  const handleCopy = useCallback(async () => {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [newKey])

  return {
    keys: query.data ?? [],
    loading: query.isPending,
    label,
    setLabel,
    creating,
    newKey,
    setNewKey,
    copied,
    revokeTarget,
    setRevokeTarget,
    revoking,
    creatingIngest,
    handleCreate,
    handleCreateIngestKey,
    handleRevoke,
    handleCopy,
  }
}
