'use client'

import { useState, useEffect, useCallback } from 'react'
import { Copy, Trash2, Plus, Key, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { apiFetch } from '../../utils'

interface ApiKeyRecord {
  id: string
  label: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

interface NewKeyResult extends ApiKeyRecord {
  key: string // full key, shown once
}

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Create form
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)

  // Newly created key modal
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null)
  const [copied, setCopied] = useState(false)

  // Revoke confirmation
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
      toast.error('Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [])

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
      toast.error('Failed to create API key')
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
      toast.success('API key revoked')
      setRevokeTarget(null)
    } catch {
      toast.error('Failed to revoke key')
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

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-8'>
          API Keys
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          Use API keys to authenticate local MCP servers (Claude Code). Keys are
          scoped to your user and workspace.
        </p>

        {/* Create form */}
        <div className='flex gap-2 mb-8'>
          <Input
            placeholder='Key label, e.g. "My laptop"'
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleCreate()}
            className='max-w-xs'
          />
          <Button
            onClick={() => void handleCreate()}
            disabled={creating || !label.trim()}
          >
            {creating ? (
              <Loader2 size={14} className='animate-spin mr-1.5' />
            ) : (
              <Plus size={14} className='mr-1.5' />
            )}
            Generate key
          </Button>
        </div>

        {/* Key list */}
        {loading ? (
          <div className='flex items-center gap-2 text-sm text-zinc-400'>
            <Loader2 size={14} className='animate-spin' />
            Loading…
          </div>
        ) : keys.length === 0 ? (
          <div className='flex flex-col items-center gap-2 py-12 text-zinc-400'>
            <Key size={28} />
            <p className='text-sm'>No API keys yet</p>
          </div>
        ) : (
          <ul className='space-y-2'>
            {keys.map(k => (
              <li
                key={k.id}
                className='flex items-center justify-between px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
              >
                <div>
                  <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                    {k.label}
                  </p>
                  <p className='text-xs text-zinc-400 font-mono mt-0.5'>
                    {k.keyPrefix}…
                    {k.lastUsedAt && (
                      <span className='font-sans ml-3'>
                        last used {new Date(k.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-zinc-400 hover:text-destructive'
                  onClick={() => setRevokeTarget(k)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* New key modal — show full key once */}
        <AlertDialog
          open={!!newKey}
          onOpenChange={open => !open && setNewKey(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>API key created</AlertDialogTitle>
              <AlertDialogDescription>
                Copy this key now — it will not be shown again.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className='flex items-center gap-2 my-2'>
              <code className='flex-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2 break-all font-mono'>
                {newKey?.key}
              </code>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void handleCopy()}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>

            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setNewKey(null)}>
                Done
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Revoke confirmation */}
        <AlertDialog
          open={!!revokeTarget}
          onOpenChange={open => !open && setRevokeTarget(null)}
        >
          <AlertDialogContent size='sm'>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Revoke &ldquo;{revokeTarget?.label}&rdquo;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Any MCP server using this key will stop working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                onClick={() => void handleRevoke()}
                disabled={revoking}
              >
                {revoking ? (
                  <Loader2 size={14} className='animate-spin' />
                ) : (
                  'Revoke'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
