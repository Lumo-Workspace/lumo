'use client'

import { useState, useCallback, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { apiFetch } from '../utils'

export interface ApiKeyRecord {
  id: string
  label: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
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
  handleCreate: () => Promise<void>
  handleRevoke: () => Promise<void>
  handleCopy: () => Promise<void>
}

export function useApiKeys(): UseApiKeysReturn {
  const intl = useIntl()

  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null)
  const [revoking, setRevoking] = useState(false)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/user/api-keys')
      if (!res.ok) throw new Error('Failed to load API keys')
      const data = (await res.json()) as { keys: ApiKeyRecord[] }
      setKeys(data.keys)
    } catch {
      toast.error(intl.formatMessage({ id: 'apiKeys.loadFailed' }))
    } finally {
      setLoading(false)
    }
  }, [intl])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const handleCreate = async () => {
    if (!label.trim()) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/user/api-keys', {
        method: 'POST',
        body: { label: label.trim() },
      })
      if (!res.ok) throw new Error('Failed to create API key')
      const result = (await res.json()) as NewKeyResult
      setNewKey(result)
      setLabel('')
      setKeys(prev => [result, ...prev])
    } catch {
      toast.error(intl.formatMessage({ id: 'apiKeys.createFailed' }))
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      const res = await apiFetch(`/api/user/api-keys/${revokeTarget.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to revoke key')
      setKeys(prev => prev.filter(k => k.id !== revokeTarget.id))
      toast.success(intl.formatMessage({ id: 'apiKeys.revokeSuccess' }))
      setRevokeTarget(null)
    } catch {
      toast.error(intl.formatMessage({ id: 'apiKeys.revokeFailed' }))
    } finally {
      setRevoking(false)
    }
  }

  const handleCopy = async () => {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return {
    keys,
    loading,
    label,
    setLabel,
    creating,
    newKey,
    setNewKey,
    copied,
    revokeTarget,
    setRevokeTarget,
    revoking,
    handleCreate,
    handleRevoke,
    handleCopy,
  }
}
