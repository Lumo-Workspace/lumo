'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Link2, Copy, Check, Globe } from 'lucide-react'
import type {
  ApiDocumentShare,
  DocShareRole,
  DocVisibility,
  WorkspaceMemberInfo,
} from '../../types'
import { documentsClient } from '@/lib/api-client'

// ─── Helper: avatar with image or initials fallback ─────────────────────────

function MemberAvatar({
  name,
  imageUrl,
  size = 32,
}: {
  name: string
  imageUrl: string | null
  size?: number
}) {
  const initials = (name || '?')
    .split(' ')
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className='rounded-full object-cover shrink-0'
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className='rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0'
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  )
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  documentTitle: string
  documentEmoji: string | null
  visibility: DocVisibility
  publicToken: string | null | undefined
  shares: ApiDocumentShare[]
  owner: { id: string; name: string; imageUrl: string | null }
  members: WorkspaceMemberInfo[]
  currentMemberId: string | undefined
  onSharesChange: (shares: ApiDocumentShare[]) => void
  onVisibilityChange: (visibility: DocVisibility) => void
  onPublicTokenChange: (token: string | null) => void
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ShareDialog({
  open,
  onOpenChange,
  documentId,
  documentTitle,
  documentEmoji,
  visibility,
  publicToken,
  shares,
  owner,
  members,
  currentMemberId,
  onSharesChange,
  onVisibilityChange,
  onPublicTokenChange,
}: ShareDialogProps) {
  const intl = useIntl()

  const [search, setSearch] = useState('')
  const [inviteRole, setInviteRole] = useState<DocShareRole>('VIEWER')
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset search when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setSearch('')
    }
  }, [open])

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  // ── Search / filter members ─────────────────────────────────────────────

  const sharedMemberIds = useMemo(() => {
    const ids = new Set<string>()
    ids.add(owner.id)
    for (const s of shares ?? []) {
      ids.add(s.memberId)
    }
    return ids
  }, [owner.id, shares])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return members.filter(m => {
      if (sharedMemberIds.has(m.id)) return false
      const nameMatch = m.name.toLowerCase().includes(q)
      const emailMatch = m.email?.toLowerCase().includes(q) ?? false
      return nameMatch || emailMatch
    })
  }, [search, members, sharedMemberIds])

  // ── Invite ──────────────────────────────────────────────────────────────

  const handleInvite = useCallback(
    async (member: WorkspaceMemberInfo) => {
      setSearch('')

      const tempId = `temp-${Date.now()}`
      const optimisticShare: ApiDocumentShare = {
        id: tempId,
        memberId: member.id,
        member: { id: member.id, name: member.name, imageUrl: member.imageUrl },
        role: inviteRole,
        createdAt: new Date().toISOString(),
      }

      const nextShares = [...shares, optimisticShare]
      onSharesChange(nextShares)

      // Auto-upgrade visibility to SHARED if currently PRIVATE
      if (visibility === 'PRIVATE') {
        onVisibilityChange('SHARED')
        documentsClient
          .update(documentId, { visibility: 'SHARED' })
          .catch(() => {
            /* best-effort */
          })
      }

      try {
        const data = await documentsClient.createShare<{
          share: ApiDocumentShare
        }>(documentId, { memberId: member.id, role: inviteRole })
        // Replace temp share with real one, preserving member display info
        // (API returns member with only id/clerkId, not name/imageUrl)
        const realShare: ApiDocumentShare = {
          ...data.share,
          member: {
            ...data.share.member,
            name: data.share.member.name ?? member.name,
            imageUrl: data.share.member.imageUrl ?? member.imageUrl,
          },
        }
        onSharesChange(nextShares.map(s => (s.id === tempId ? realShare : s)))
      } catch {
        onSharesChange(shares)
      }
    },
    [
      shares,
      inviteRole,
      visibility,
      documentId,
      onSharesChange,
      onVisibilityChange,
    ]
  )

  // ── Role change ─────────────────────────────────────────────────────────

  const handleRoleChange = useCallback(
    async (shareId: string, newRole: DocShareRole) => {
      const prev = shares
      onSharesChange(
        shares.map(s => (s.id === shareId ? { ...s, role: newRole } : s))
      )

      try {
        await documentsClient.updateShare(documentId, shareId, {
          role: newRole,
        })
      } catch {
        onSharesChange(prev)
      }
    },
    [shares, documentId, onSharesChange]
  )

  // ── Remove share ────────────────────────────────────────────────────────

  const handleRemove = useCallback(
    async (shareId: string) => {
      const share = shares.find(s => s.id === shareId)
      const prev = shares
      const nextShares = shares.filter(s => s.id !== shareId)
      onSharesChange(nextShares)

      // If removing self, close dialog
      const isSelf = share?.memberId === currentMemberId
      if (isSelf) {
        onOpenChange(false)
      }

      // If removing last share, downgrade to PRIVATE
      if (nextShares.length === 0 && visibility === 'SHARED') {
        onVisibilityChange('PRIVATE')
        documentsClient
          .update(documentId, { visibility: 'PRIVATE' })
          .catch(() => {
            /* best-effort */
          })
      }

      try {
        await documentsClient.deleteShare(documentId, shareId)
      } catch {
        onSharesChange(prev)
      }
    },
    [
      shares,
      visibility,
      documentId,
      currentMemberId,
      onSharesChange,
      onVisibilityChange,
      onOpenChange,
    ]
  )

  // ── Public link toggle ──────────────────────────────────────────────────

  const handlePublicToggle = useCallback(
    async (enabled: boolean) => {
      const token = enabled
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 21)
        : null

      onPublicTokenChange(token)

      try {
        await documentsClient.update(documentId, { publicToken: token })
      } catch {
        // Rollback
        onPublicTokenChange(enabled ? null : (publicToken ?? null))
      }
    },
    [documentId, publicToken, onPublicTokenChange]
  )

  // ── Copy link ───────────────────────────────────────────────────────────

  const handleCopyLink = useCallback(() => {
    if (!publicToken) return
    const url = `${window.location.origin}/share/${publicToken}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2000)
    })
  }, [publicToken])

  // ── Role label helper ───────────────────────────────────────────────────

  function roleLabel(role: DocShareRole): string {
    switch (role) {
      case 'VIEWER':
        return intl.formatMessage({ id: 'share.viewer' })
      case 'EDITOR':
        return intl.formatMessage({ id: 'share.editor' })
      case 'MANAGER':
        return intl.formatMessage({ id: 'share.manager' })
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md !grid-rows-[auto_1fr] max-h-[85vh]'>
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: 'share.title' })}</DialogTitle>
          <p className='flex items-center gap-1 text-sm text-muted-foreground'>
            {documentEmoji && <span>{documentEmoji}</span>}
            {documentTitle ||
              intl.formatMessage({
                id: 'documents.untitled',
                defaultMessage: 'Untitled',
              })}
          </p>
        </DialogHeader>

        <div className='overflow-y-auto space-y-4'>
          {/* ── Invite section ─────────────────────────────────────────── */}
          <div className='relative'>
            <div className='flex items-center gap-2'>
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'share.searchPlaceholder',
                })}
                className='flex-1'
              />
              <Select
                value={inviteRole}
                onValueChange={v => setInviteRole(v as DocShareRole)}
              >
                <SelectTrigger className='w-[120px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='VIEWER'>{roleLabel('VIEWER')}</SelectItem>
                  <SelectItem value='EDITOR'>{roleLabel('EDITOR')}</SelectItem>
                  <SelectItem value='MANAGER'>
                    {roleLabel('MANAGER')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Search dropdown */}
            {searchResults.length > 0 && (
              <div className='absolute left-0 right-0 top-full mt-1 z-dropdown bg-popover border rounded-md shadow-elevation-2 max-h-48 overflow-y-auto'>
                {searchResults.map(m => (
                  <button
                    key={m.id}
                    type='button'
                    className='flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left'
                    onClick={() => handleInvite(m)}
                  >
                    <MemberAvatar
                      name={m.name}
                      imageUrl={m.imageUrl}
                      size={24}
                    />
                    <div className='flex-1 min-w-0'>
                      <div className='truncate font-medium'>{m.name}</div>
                      {m.email && (
                        <div className='truncate text-xs text-muted-foreground'>
                          {m.email}
                        </div>
                      )}
                    </div>
                    <span className='text-xs text-muted-foreground shrink-0'>
                      {intl.formatMessage({ id: 'share.invite' })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Current shares ─────────────────────────────────────────── */}
          <div className='space-y-1'>
            <div className='text-xs font-medium text-muted-foreground px-1 mb-2'>
              {intl.formatMessage({ id: 'share.sharedWith' })}
            </div>

            {/* Owner row */}
            <div className='flex items-center gap-2 px-1 py-1.5'>
              <MemberAvatar
                name={owner.name}
                imageUrl={owner.imageUrl}
                size={28}
              />
              <div className='flex-1 min-w-0'>
                <div className='text-sm truncate'>{owner.name}</div>
              </div>
              <span className='text-xs text-muted-foreground'>
                {intl.formatMessage({ id: 'share.owner' })}
              </span>
            </div>

            {/* Share rows */}
            {(shares ?? []).map(share => (
              <div
                key={share.id}
                className='flex items-center gap-2 px-1 py-1.5'
              >
                <MemberAvatar
                  name={share.member.name}
                  imageUrl={share.member.imageUrl}
                  size={28}
                />
                <div className='flex-1 min-w-0'>
                  <div className='text-sm truncate'>{share.member.name}</div>
                </div>
                <Select
                  value={share.role}
                  onValueChange={v => {
                    if (v === '__remove__') {
                      handleRemove(share.id)
                    } else {
                      handleRoleChange(share.id, v as DocShareRole)
                    }
                  }}
                >
                  <SelectTrigger className='w-[120px] h-8 text-xs'>
                    <SelectValue>{roleLabel(share.role)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='VIEWER'>
                      {roleLabel('VIEWER')}
                    </SelectItem>
                    <SelectItem value='EDITOR'>
                      {roleLabel('EDITOR')}
                    </SelectItem>
                    <SelectItem value='MANAGER'>
                      {roleLabel('MANAGER')}
                    </SelectItem>
                    <SelectSeparator />
                    <SelectItem value='__remove__' className='text-danger-text'>
                      {intl.formatMessage({ id: 'share.remove' })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          {/* ── Public link section ────────────────────────────────────── */}
          <div className='border-t pt-4 mt-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Globe className='h-4 w-4 text-muted-foreground' />
                <div>
                  <div className='text-sm font-medium'>
                    {intl.formatMessage({ id: 'share.publicLink' })}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {intl.formatMessage({ id: 'share.publicLinkDesc' })}
                  </div>
                </div>
              </div>
              <Switch
                checked={!!publicToken}
                onCheckedChange={handlePublicToggle}
              />
            </div>

            {publicToken && (
              <div className='flex items-center gap-2 mt-3'>
                <div className='flex-1 flex items-center gap-2 bg-muted rounded-md px-3 py-1.5 text-xs text-muted-foreground truncate'>
                  <Link2 className='h-3 w-3 shrink-0' />
                  <span className='truncate'>
                    {window.location.origin}/share/{publicToken}
                  </span>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  className='shrink-0'
                  onClick={handleCopyLink}
                >
                  {copied ? (
                    <>
                      <Check className='h-3.5 w-3.5 mr-1' />
                      {intl.formatMessage({ id: 'share.copied' })}
                    </>
                  ) : (
                    <>
                      <Copy className='h-3.5 w-3.5 mr-1' />
                      {intl.formatMessage({ id: 'share.copyLink' })}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
