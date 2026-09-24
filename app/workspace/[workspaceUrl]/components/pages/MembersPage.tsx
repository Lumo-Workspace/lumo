'use client'

import { useState, useEffect } from 'react'
import { Plus, MoreHorizontal, RefreshCw } from 'lucide-react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useMembers } from '../../hooks/useMembers'
import { useInvites } from '../../hooks/useInvites'
import { useLeaveWorkspace } from '../../hooks/useLeaveWorkspace'
import { workspacesClient } from '@/lib/api-client'
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string, locale: string = 'en') {
  return new Date(iso).toLocaleDateString(locale, {
    month: 'short',
    year: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MembersPage() {
  const intl = useIntl()
  const { user } = useCurrentUser()
  const { members, setMembers, invalidateMembers } = useMembers()

  const {
    invites,
    loadingInvites,
    inviteOpen,
    setInviteOpen,
    emailInputs,
    resetEmails,
    sending,
    revokeToken,
    setRevokeToken,
    revoking,
    resendingToken,
    fetchInvites,
    handleSendInvites,
    handleRevoke,
    handleResend,
    addEmailField,
    updateEmail,
    removeEmail,
  } = useInvites()

  // Current user's role
  const currentMember = members.find(m => m.clerkId === user?.id)
  const isOwner = currentMember?.role === 'OWNER'
  const ownerCount = members.filter(m => m.role === 'OWNER').length
  const canLeave = !(isOwner && ownerCount <= 1)

  // Role update
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)

  // Leave workspace
  const [leaveOpen, setLeaveOpen] = useState(false)
  const { leave, leaving } = useLeaveWorkspace()

  // Members come from the shared useMembers cache (fetched once on workspace
  // mount, staleTime 5min); mutations below invalidate it. Only invites need
  // an explicit fetch here.
  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

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
      await workspacesClient.updateMember(memberId, { role: newRole })
      // Reconcile the shared members cache so every other page reflects the
      // new role instead of waiting out staleTime.
      void invalidateMembers()
      toast.success(intl.formatMessage({ id: 'members.roleUpdated' }))
    } catch (err) {
      // Rollback
      setMembers(ms =>
        ms.map(m => (m.id === memberId ? { ...m, role: prev.role } : m))
      )
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'members.roleUpdateFailed' })
      )
    } finally {
      setUpdatingRoleId(null)
    }
  }

  // ─── Leave workspace ────────────────────────────────────────────────────────
  const handleLeave = async () => {
    try {
      await leave()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'members.leaveFailed' })
      )
      setLeaveOpen(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-5xl mx-auto px-6 py-8'>
        {/* Header */}
        <div className='flex items-center justify-between mb-8'>
          <h1 className='text-xl font-semibold text-foreground'>
            {intl.formatMessage({ id: 'members.title' })}
          </h1>
          <Button
            size='sm'
            className='gap-1.5'
            onClick={() => setInviteOpen(true)}
          >
            <Plus size={14} />
            {intl.formatMessage({ id: 'common.invite' })}
          </Button>
        </div>

        {/* Active members */}
        <section className='mb-8'>
          <div className='flex items-center gap-2 mb-3'>
            <span className='text-sm font-medium text-foreground'>
              {intl.formatMessage({ id: 'members.active' })}
            </span>
            <span className='text-xs text-muted-foreground'>
              {members.length}
            </span>
          </div>

          <div className='rounded-lg border border-border overflow-hidden'>
            {/* Table header */}
            <div className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 px-4 py-2 bg-muted border-b border-border'>
              <span className='text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'members.colName' })}
              </span>
              <span className='text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'members.colEmail' })}
              </span>
              <span className='text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'members.colRole' })}
              </span>
              <span className='text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'members.colJoined' })}
              </span>
              <span />
            </div>

            {members.length === 0 ? (
              <div className='px-4 py-6 text-sm text-muted-foreground text-center'>
                {intl.formatMessage({ id: 'common.loading' })}
              </div>
            ) : (
              members.map(m => (
                <div
                  key={m.id}
                  className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 items-center px-4 py-3 border-b border-border/50 last:border-0'
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
                      <div className='size-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-foreground shrink-0 uppercase'>
                        {getInitials(m.name)}
                      </div>
                    )}
                    <span className='text-sm font-medium text-foreground truncate'>
                      {m.name}
                    </span>
                  </div>

                  {/* Email */}
                  <span className='text-sm text-muted-foreground truncate'>
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
                    <SelectTrigger className='h-7 w-24 text-xs border-border focus:ring-1'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='OWNER' className='text-xs'>
                        {intl.formatMessage({ id: 'members.roleAdmin' })}
                      </SelectItem>
                      <SelectItem value='MEMBER' className='text-xs'>
                        {intl.formatMessage({ id: 'members.roleMember' })}
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Joined */}
                  <span className='text-sm text-muted-foreground shrink-0 whitespace-nowrap'>
                    {formatDate(m.joinedAt, intl.locale)}
                  </span>

                  {/* Actions — only show for self if they can leave */}
                  {m.id === currentMember?.id && canLeave ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 text-muted-foreground hover:text-foreground shrink-0'
                        >
                          <MoreHorizontal size={13} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          className='cursor-pointer text-destructive focus:text-destructive'
                          onClick={() => setLeaveOpen(true)}
                        >
                          {intl.formatMessage({ id: 'members.leaveWorkspace' })}
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
              <span className='text-sm font-medium text-foreground'>
                {intl.formatMessage({ id: 'members.invited' })}
              </span>
              <span className='text-xs text-muted-foreground'>
                {invites.length}
              </span>
            </div>

            <div className='rounded-lg border border-border overflow-hidden'>
              {/* Table header — same columns as Active */}
              <div className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 px-4 py-2 bg-muted border-b border-border'>
                <span className='text-xs font-medium text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colName' })}
                </span>
                <span className='text-xs font-medium text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colEmail' })}
                </span>
                <span className='text-xs font-medium text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colRole' })}
                </span>
                <span className='text-xs font-medium text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colSent' })}
                </span>
                <span />
              </div>

              {loadingInvites && invites.length === 0 ? (
                <div className='px-4 py-6 text-sm text-muted-foreground text-center'>
                  {intl.formatMessage({ id: 'common.loading' })}
                </div>
              ) : (
                invites.map(inv => (
                  <div
                    key={inv.id}
                    className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 items-center px-4 py-3 border-b border-border/50 last:border-0'
                  >
                    {/* Name — show email with avatar (no real name yet) */}
                    <div className='flex items-center gap-2.5 min-w-0'>
                      <div className='size-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0 uppercase'>
                        {inv.email[0]}
                      </div>
                      <span className='text-sm text-foreground truncate'>
                        {inv.email}
                      </span>
                    </div>

                    {/* Email */}
                    <span className='text-sm text-muted-foreground truncate'>
                      {inv.email}
                    </span>

                    {/* Role — always disabled for pending invites */}
                    <Select value='MEMBER' disabled>
                      <SelectTrigger className='h-7 w-24 text-xs border-border'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='MEMBER' className='text-xs'>
                          {intl.formatMessage({ id: 'members.roleMember' })}
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Sent date */}
                    <span className='text-sm text-muted-foreground whitespace-nowrap'>
                      {formatDate(inv.createdAt, intl.locale)}
                    </span>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 text-muted-foreground hover:text-foreground shrink-0'
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
                          {intl.formatMessage({ id: 'members.resendInvite' })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className='cursor-pointer text-destructive focus:text-destructive'
                          onClick={() => setRevokeToken(inv.token)}
                        >
                          {intl.formatMessage({ id: 'members.revokeInvite' })}
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
          if (!open) resetEmails()
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: 'members.inviteTitle' })}
            </DialogTitle>
          </DialogHeader>

          <div className='space-y-2 py-2'>
            {emailInputs.map((field, i) => (
              <div key={field.id} className='flex gap-2'>
                <input
                  type='email'
                  placeholder={intl.formatMessage({
                    id: 'members.emailPlaceholder',
                  })}
                  value={field.value}
                  onChange={e => updateEmail(field.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addEmailField()
                    }
                  }}
                  className='flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'
                  autoFocus={i === emailInputs.length - 1 && i > 0}
                />
                {emailInputs.length > 1 && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-9 w-9 shrink-0 text-muted-foreground'
                    onClick={() => removeEmail(field.id)}
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
                className='text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1 transition-colors'
              >
                <Plus size={12} />
                {intl.formatMessage({ id: 'members.addAnother' })}
              </button>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setInviteOpen(false)
                resetEmails()
              }}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              onClick={handleSendInvites}
              disabled={
                sending || emailInputs.every(f => f.value.trim() === '')
              }
            >
              {sending
                ? intl.formatMessage({ id: 'common.sending' })
                : intl.formatMessage({ id: 'members.sendInvites' })}
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
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'members.leaveTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'members.leaveDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={handleLeave}
              disabled={leaving}
            >
              {leaving
                ? intl.formatMessage({ id: 'common.leaving' })
                : intl.formatMessage({ id: 'members.leaveWorkspace' })}
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
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'members.revokeTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'members.revokeDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking
                ? intl.formatMessage({ id: 'common.revoking' })
                : intl.formatMessage({ id: 'common.revoke' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
