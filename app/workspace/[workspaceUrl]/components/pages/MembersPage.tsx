'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, MoreHorizontal, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useMembers } from '../../hooks/useMembers'
import { readCache, writeCache, clearCache } from '../../cache'
import { API, CACHE_KEY } from '../../constants'
import { apiFetch } from '../../utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getInitials } from '@/lib/utils/getInitials'
// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingInvite {
  id: string
  token: string
  email: string
  inviterName: string
  expiresAt: string
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MembersPage() {
  const { user } = useCurrentUser()
  const { members, setMembers, fetchMembers } = useMembers()
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loadingInvites, setLoadingInvites] = useState(true)

  // Current user's role
  const currentMember = members.find(m => m.clerkId === user?.id)
  const isOwner = currentMember?.role === 'OWNER'
  const ownerCount = members.filter(m => m.role === 'OWNER').length
  const canLeave = !(isOwner && ownerCount <= 1)

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [emailInputs, setEmailInputs] = useState([''])
  const [sending, setSending] = useState(false)

  // Revoke confirm
  const [revokeToken, setRevokeToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  // Resend
  const [resendingToken, setResendingToken] = useState<string | null>(null)

  // Role update
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)

  // Leave workspace
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // ─── Fetch invites ──────────────────────────────────────────────────────────
  const fetchInvites = useCallback(async () => {
    // Seed from cache immediately (stale-while-revalidate)
    const cached = readCache<PendingInvite[]>(CACHE_KEY.invites)
    if (cached) {
      setInvites(cached)
      setLoadingInvites(false)
    }
    try {
      const res = await fetch(API.invites.list)
      if (res.ok) {
        const data = (await res.json()) as { invites: PendingInvite[] }
        setInvites(data.invites)
        writeCache(CACHE_KEY.invites, data.invites)
      }
    } finally {
      setLoadingInvites(false)
    }
  }, [])

  useEffect(() => {
    fetchMembers()
    fetchInvites()
  }, [fetchMembers, fetchInvites])

  // ─── Send invites ───────────────────────────────────────────────────────────
  const handleSendInvites = async () => {
    const emails = emailInputs.map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) return

    setSending(true)
    try {
      // Get workspaceId from the members API (any member has it via the workspace)
      const wsRes = await fetch('/api/workspaces/me')
      if (!wsRes.ok) throw new Error('Could not fetch workspace')
      const wsData = await wsRes.json()
      const workspaceId = wsData.workspace.id

      const res = await apiFetch(API.invites.list, {
        method: 'POST',
        body: { emails, workspaceId },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to send invites')

      toast.success(
        `${data.sent} invite${data.sent !== 1 ? 's' : ''} sent`,
        data.failed?.length
          ? { description: `Failed: ${data.failed.join(', ')}` }
          : undefined
      )
      setInviteOpen(false)
      setEmailInputs([''])
      await fetchInvites()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invites')
    } finally {
      setSending(false)
    }
  }

  // ─── Revoke invite ──────────────────────────────────────────────────────────
  const handleRevoke = async () => {
    if (!revokeToken) return
    setRevoking(true)
    try {
      const res = await fetch(API.invites.byToken(revokeToken), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to revoke invite')
      setInvites(prev => {
        const next = prev.filter(i => i.token !== revokeToken)
        writeCache(CACHE_KEY.invites, next)
        return next
      })
      toast.success('Invite revoked')
    } catch {
      toast.error('Failed to revoke invite')
    } finally {
      setRevoking(false)
      setRevokeToken(null)
    }
  }

  // ─── Resend invite ──────────────────────────────────────────────────────────
  const handleResend = async (token: string) => {
    setResendingToken(token)
    try {
      const res = await fetch(API.invites.resend(token), { method: 'POST' })
      if (!res.ok) throw new Error('Failed to resend invite')
      toast.success('Invite resent')
      await fetchInvites()
    } catch {
      toast.error('Failed to resend invite')
    } finally {
      setResendingToken(null)
    }
  }

  // ─── Role update ────────────────────────────────────────────────────────────
  const handleRoleChange = async (
    memberId: string,
    newRole: 'OWNER' | 'MEMBER'
  ) => {
    const prev = members.find(m => m.id === memberId)
    if (!prev || prev.role === newRole) return

    // Optimistic update
    setMembers(ms =>
      ms.map(m => (m.id === memberId ? { ...m, role: newRole } : m))
    )
    setUpdatingRoleId(memberId)
    try {
      const res = await apiFetch(API.workspaces.memberById(memberId), {
        method: 'PATCH',
        body: { role: newRole },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update role')
      toast.success('Role updated')
    } catch (err) {
      // Rollback
      setMembers(ms =>
        ms.map(m => (m.id === memberId ? { ...m, role: prev.role } : m))
      )
      toast.error(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setUpdatingRoleId(null)
    }
  }

  // ─── Leave workspace ────────────────────────────────────────────────────────
  const handleLeave = async () => {
    setLeaving(true)
    try {
      const res = await fetch(API.workspaces.leaveWorkspace, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to leave workspace')
      clearCache()
      window.location.href = '/onboarding'
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to leave workspace'
      )
      setLeaving(false)
      setLeaveOpen(false)
    }
  }

  // ─── Email input helpers ────────────────────────────────────────────────────
  const addEmailField = () => {
    if (emailInputs.length < 10) setEmailInputs(prev => [...prev, ''])
  }
  const updateEmail = (index: number, value: string) => {
    setEmailInputs(prev => prev.map((e, i) => (i === index ? value : e)))
  }
  const removeEmail = (index: number) => {
    if (emailInputs.length === 1) {
      setEmailInputs([''])
    } else {
      setEmailInputs(prev => prev.filter((_, i) => i !== index))
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-5xl mx-auto px-6 py-8'>
        {/* Header */}
        <div className='flex items-center justify-between mb-8'>
          <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100'>
            Members
          </h1>
          <Button
            size='sm'
            className='gap-1.5'
            onClick={() => setInviteOpen(true)}
          >
            <Plus size={14} />
            Invite
          </Button>
        </div>

        {/* Active members */}
        <section className='mb-8'>
          <div className='flex items-center gap-2 mb-3'>
            <span className='text-sm font-medium text-zinc-700 dark:text-zinc-300'>
              Active
            </span>
            <span className='text-xs text-zinc-400'>{members.length}</span>
          </div>

          <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
            {/* Table header */}
            <div className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800'>
              <span className='text-xs font-medium text-zinc-500'>Name</span>
              <span className='text-xs font-medium text-zinc-500'>Email</span>
              <span className='text-xs font-medium text-zinc-500'>Role</span>
              <span className='text-xs font-medium text-zinc-500'>Joined</span>
              <span />
            </div>

            {members.length === 0 ? (
              <div className='px-4 py-6 text-sm text-zinc-400 text-center'>
                Loading...
              </div>
            ) : (
              members.map(m => (
                <div
                  key={m.id}
                  className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 items-center px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50 last:border-0'
                >
                  {/* Name + avatar */}
                  <div className='flex items-center gap-2.5 min-w-0'>
                    {m.imageUrl ? (
                      <img
                        src={m.imageUrl}
                        alt={m.name}
                        className='size-7 rounded-full object-cover shrink-0'
                        referrerPolicy='no-referrer'
                      />
                    ) : (
                      <div className='size-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 shrink-0 uppercase'>
                        {getInitials(m.name)}
                      </div>
                    )}
                    <span className='text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate'>
                      {m.name}
                    </span>
                  </div>

                  {/* Email */}
                  <span className='text-sm text-zinc-500 dark:text-zinc-400 truncate'>
                    {m.email ?? '—'}
                  </span>

                  {/* Role — editable Select for owners, static Badge for self/members */}
                  <Select
                    value={m.role}
                    onValueChange={val =>
                      handleRoleChange(m.id, val as 'OWNER' | 'MEMBER')
                    }
                    disabled={
                      !isOwner ||
                      m.id === currentMember?.id ||
                      updatingRoleId === m.id
                    }
                  >
                    <SelectTrigger className='h-7 w-24 text-xs border-zinc-200 dark:border-zinc-700 focus:ring-1'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='OWNER' className='text-xs'>
                        Admin
                      </SelectItem>
                      <SelectItem value='MEMBER' className='text-xs'>
                        Member
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Joined */}
                  <span className='text-sm text-zinc-400 shrink-0 whitespace-nowrap'>
                    {formatDate(m.joinedAt)}
                  </span>

                  {/* Actions — only show for self if they can leave */}
                  {m.id === currentMember?.id && canLeave ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0'
                        >
                          <MoreHorizontal size={13} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          className='cursor-pointer text-destructive focus:text-destructive'
                          onClick={() => setLeaveOpen(true)}
                        >
                          Leave workspace
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span />
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Invited (pending) */}
        {(invites.length > 0 || loadingInvites) && (
          <section>
            <div className='flex items-center gap-2 mb-3'>
              <span className='text-sm font-medium text-zinc-700 dark:text-zinc-300'>
                Invited
              </span>
              <span className='text-xs text-zinc-400'>{invites.length}</span>
            </div>

            <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
              {/* Table header — same columns as Active */}
              <div className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800'>
                <span className='text-xs font-medium text-zinc-500'>Name</span>
                <span className='text-xs font-medium text-zinc-500'>Email</span>
                <span className='text-xs font-medium text-zinc-500'>Role</span>
                <span className='text-xs font-medium text-zinc-500'>Sent</span>
                <span />
              </div>

              {loadingInvites && invites.length === 0 ? (
                <div className='px-4 py-6 text-sm text-zinc-400 text-center'>
                  Loading...
                </div>
              ) : (
                invites.map(inv => (
                  <div
                    key={inv.id}
                    className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 items-center px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50 last:border-0'
                  >
                    {/* Name — show email with avatar (no real name yet) */}
                    <div className='flex items-center gap-2.5 min-w-0'>
                      <div className='size-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-semibold text-zinc-400 shrink-0 uppercase'>
                        {inv.email[0]}
                      </div>
                      <span className='text-sm text-zinc-700 dark:text-zinc-300 truncate'>
                        {inv.email}
                      </span>
                    </div>

                    {/* Email */}
                    <span className='text-sm text-zinc-500 dark:text-zinc-400 truncate'>
                      {inv.email}
                    </span>

                    {/* Role — always disabled for pending invites */}
                    <Select value='MEMBER' disabled>
                      <SelectTrigger className='h-7 w-24 text-xs border-zinc-200 dark:border-zinc-700'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='MEMBER' className='text-xs'>
                          Member
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Sent date */}
                    <span className='text-sm text-zinc-400 whitespace-nowrap'>
                      {formatDate(inv.createdAt)}
                    </span>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0'
                          disabled={resendingToken === inv.token}
                        >
                          {resendingToken === inv.token ? (
                            <RefreshCw size={13} className='animate-spin' />
                          ) : (
                            <MoreHorizontal size={13} />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          className='cursor-pointer'
                          onClick={() => handleResend(inv.token)}
                        >
                          Resend invite
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className='cursor-pointer text-destructive focus:text-destructive'
                          onClick={() => setRevokeToken(inv.token)}
                        >
                          Revoke invite
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      {/* ─── Invite dialog ───────────────────────────────────────────────────── */}
      <Dialog
        open={inviteOpen}
        onOpenChange={open => {
          setInviteOpen(open)
          if (!open) setEmailInputs([''])
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Invite teammates</DialogTitle>
          </DialogHeader>

          <div className='space-y-2 py-2'>
            {emailInputs.map((email, i) => (
              <div key={i} className='flex gap-2'>
                <input
                  type='email'
                  placeholder='colleague@company.com'
                  value={email}
                  onChange={e => updateEmail(i, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addEmailField()
                    }
                  }}
                  className='flex-1 h-9 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 placeholder:text-zinc-400'
                  autoFocus={i === emailInputs.length - 1 && i > 0}
                />
                {emailInputs.length > 1 && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-9 w-9 shrink-0 text-zinc-400'
                    onClick={() => removeEmail(i)}
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
            ))}

            {emailInputs.length < 10 && (
              <button
                type='button'
                onClick={addEmailField}
                className='text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1 mt-1 transition-colors'
              >
                <Plus size={12} />
                Add another
              </button>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setInviteOpen(false)
                setEmailInputs([''])
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendInvites}
              disabled={sending || emailInputs.every(e => e.trim() === '')}
            >
              {sending ? 'Sending…' : 'Send invites'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Leave workspace confirm ─────────────────────────────────────────── */}
      <AlertDialog
        open={leaveOpen}
        onOpenChange={open => {
          if (!open) setLeaveOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose access to all projects and tasks in this workspace.
              You can only rejoin via a new invite.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={handleLeave}
              disabled={leaving}
            >
              {leaving ? 'Leaving…' : 'Leave workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Revoke confirm ──────────────────────────────────────────────────── */}
      <AlertDialog
        open={!!revokeToken}
        onOpenChange={open => {
          if (!open) setRevokeToken(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invite?</AlertDialogTitle>
            <AlertDialogDescription>
              This invite link will stop working immediately. You can send a new
              invite later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? 'Revoking…' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
