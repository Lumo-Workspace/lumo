'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Plus,
  MoreHorizontal,
  RefreshCw,
  Search,
  ChevronDown,
} from 'lucide-react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useMembers } from '../../hooks/useMembers'
import { useMemberConnections } from '../../hooks/useMemberConnections'
import { useNow } from '@/hooks/use-now'
import { MemberConnectionsCell } from '../members/MemberConnectionsCell'
import { MemberVersionStatus } from '../members/MemberVersionStatus'
import { MemberConnectionDetails } from '../members/MemberConnectionDetails'
import { MemberFilterTabs } from '../members/MemberFilterTabs'
import { ConnectionUpdateBanner } from '../members/ConnectionUpdateBanner'
import { useVersionDismissal } from '../../hooks/useVersionDismissal'
import {
  countConnectionsNeedingUpdate,
  matchesMemberFilter,
  matchesMemberQuery,
  memberVersionStatus,
  MEMBER_FILTERS,
  type MemberFilter,
} from '@/lib/members/connection-status'
import { useInvites } from '../../hooks/useInvites'
import { useLeaveWorkspace } from '../../hooks/useLeaveWorkspace'
import { useRemoveMember } from '../../hooks/useRemoveMember'
import { workspacesClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
import { MemberAvatar } from '@/components/MemberAvatar'
import { AsyncContent } from '../AsyncContent'
import { RowListSkeleton } from '../skeletons/RowListSkeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string, locale: string = 'en') {
  return new Date(iso).toLocaleDateString(locale, {
    month: 'short',
    year: 'numeric',
  })
}

/** Shared column template for the members table header and rows. */
const ROW_GRID =
  'grid grid-cols-[minmax(200px,1.6fr)_minmax(200px,1.5fr)_minmax(160px,1.3fr)_104px_88px_80px] gap-4'

const BANNER_DISMISS_KEY = 'lumo.members.updateBannerDismissed'

// ─── Component ────────────────────────────────────────────────────────────────

export function MembersPage() {
  const intl = useIntl()
  const { user } = useCurrentUser()
  const { members, setMembers, invalidateMembers } = useMembers()
  const {
    connections,
    latestCliVersion,
    loading: loadingConnections,
    unavailable: connectionsUnavailable,
  } = useMemberConnections()
  const now = useNow()
  const connectionsUnknown = loadingConnections || connectionsUnavailable

  // Filters, search, expanded row (LUM-1136 redesign)
  const [filter, setFilter] = useState<MemberFilter>('all')
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { dismissed: bannerDismissed, dismiss: dismissBanner } =
    useVersionDismissal(BANNER_DISMISS_KEY, latestCliVersion)

  const { visibleMembers, filterCounts } = useMemo(() => {
    const searched = members.filter(m => matchesMemberQuery(m, query))
    // Until connections load, status is unknown: only "All" can filter.
    if (connectionsUnknown)
      return {
        visibleMembers: filter === 'all' ? searched : [],
        filterCounts: { all: searched.length },
      }
    const statusOf = (id: string) => memberVersionStatus(connections[id])
    const counts: Partial<Record<MemberFilter, number>> = {}
    for (const f of MEMBER_FILTERS)
      counts[f] = searched.filter(m =>
        matchesMemberFilter(statusOf(m.id), f)
      ).length
    return {
      visibleMembers: searched.filter(m =>
        matchesMemberFilter(statusOf(m.id), filter)
      ),
      filterCounts: counts,
    }
  }, [members, query, filter, connections, connectionsUnknown])

  const behindCount = connectionsUnknown
    ? 0
    : countConnectionsNeedingUpdate(connections)
  const showBanner = behindCount > 0 && !bannerDismissed

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

  // Remove another member (OWNER only, LUM-906)
  const [removeTarget, setRemoveTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const { remove, removingId } = useRemoveMember()

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

  // ─── Remove member ──────────────────────────────────────────────────────────
  const handleRemove = async () => {
    if (!removeTarget) return
    const { id, name } = removeTarget
    try {
      await remove(id)
      toast.success(intl.formatMessage({ id: 'members.removed' }, { name }))
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'members.removeFailed' })
      )
    } finally {
      setRemoveTarget(null)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6'>
        {/* Header */}
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-heading text-foreground'>
              {intl.formatMessage({ id: 'members.title' })}
            </h1>
            <p className='text-body text-muted-foreground'>
              {intl.formatMessage({ id: 'members.subtitle' })}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative flex items-center'>
              <Search
                size={14}
                aria-hidden
                className='pointer-events-none absolute left-3 text-muted-foreground'
              />
              <input
                type='search'
                aria-label={intl.formatMessage({ id: 'members.search.label' })}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'members.search.placeholder',
                })}
                className='h-9 w-60 rounded-md border border-border bg-transparent pl-8 pr-3 text-body text-foreground outline-none focus-visible:border-ring placeholder:text-muted-foreground'
              />
            </div>
            <Button className='gap-1.5' onClick={() => setInviteOpen(true)}>
              <Plus size={14} />
              {intl.formatMessage({ id: 'common.invite' })}
            </Button>
          </div>
        </div>

        {/* Update notice (LUM-1136) */}
        {showBanner && (
          <ConnectionUpdateBanner
            count={behindCount}
            onShowWho={() => setFilter('needsUpdate')}
            onDismiss={dismissBanner}
          />
        )}

        {/* Active members */}
        <section className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <MemberFilterTabs
              value={filter}
              counts={filterCounts}
              onChange={setFilter}
            />
            {latestCliVersion && (
              <p className='text-caption text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'members.latestRelease' },
                  {
                    version: (
                      <span key='v' className='font-mono text-foreground'>
                        {intl.formatMessage(
                          { id: 'members.connection.cli' },
                          { version: latestCliVersion }
                        )}
                      </span>
                    ),
                  }
                )}
              </p>
            )}
          </div>

          <div className='overflow-x-auto rounded-lg border border-border'>
            <div className='min-w-[960px]'>
              {/* Table header */}
              <div
                className={`${ROW_GRID} px-4 py-2 bg-muted border-b border-border`}
              >
                {(
                  [
                    'members.colMember',
                    'members.colAgents',
                    'members.colStatus',
                    'members.colRole',
                    'members.colJoined',
                  ] as const
                ).map(id => (
                  <span key={id} className='text-caption text-muted-foreground'>
                    {intl.formatMessage({ id })}
                  </span>
                ))}
                <span />
              </div>

              <AsyncContent
                loading={members.length === 0}
                empty={visibleMembers.length === 0}
                loadingState={
                  <RowListSkeleton
                    rows={4}
                    leading='avatar'
                    rowClassName='px-4 py-3'
                  />
                }
                emptyState={
                  <p className='text-body text-muted-foreground'>
                    {intl.formatMessage({ id: 'members.filter.empty' })}
                  </p>
                }
              >
                {visibleMembers.map(m => {
                  const isSelf = m.id === currentMember?.id
                  const expanded = expandedId === m.id
                  const memberConnections = connections[m.id]
                  return (
                    <Collapsible
                      key={m.id}
                      open={expanded && !connectionsUnknown}
                      onOpenChange={open => setExpandedId(open ? m.id : null)}
                      className='border-b border-border/50 last:border-0'
                    >
                      <div
                        className={`${ROW_GRID} items-center px-4 py-3 min-h-16`}
                      >
                        {/* Member — avatar, name, email */}
                        <div className='flex items-center gap-3 min-w-0'>
                          <MemberAvatar
                            decorative
                            name={m.name}
                            imageUrl={m.imageUrl}
                            size='xl'
                          />
                          <div className='flex min-w-0 flex-col'>
                            <div className='flex items-center gap-2 min-w-0'>
                              <span className='text-body-strong text-foreground truncate'>
                                {m.name}
                              </span>
                              {isSelf && (
                                <span className='shrink-0 rounded-full border border-border px-1.5 text-caption text-muted-foreground'>
                                  {intl.formatMessage({ id: 'members.you' })}
                                </span>
                              )}
                            </div>
                            <span className='text-caption text-muted-foreground truncate'>
                              {m.email ?? '—'}
                            </span>
                          </div>
                        </div>

                        {/* Agents (LUM-1136) */}
                        <MemberConnectionsCell
                          connections={memberConnections}
                          unknown={connectionsUnknown}
                          now={now}
                        />

                        {/* Version status (LUM-1136) */}
                        <MemberVersionStatus
                          connections={memberConnections}
                          latestCliVersion={latestCliVersion}
                          unknown={connectionsUnknown}
                        />

                        {/* Role — editable Select for owners, disabled for self/members */}
                        <Select
                          value={m.role}
                          onValueChange={val =>
                            handleRoleChange(m.id, val as 'OWNER' | 'MEMBER')
                          }
                          disabled={
                            !isOwner || isSelf || updatingRoleId === m.id
                          }
                        >
                          <SelectTrigger
                            aria-label={intl.formatMessage(
                              { id: 'members.roleFor' },
                              { name: m.name }
                            )}
                            className='w-24 text-caption border-border'
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='OWNER' className='text-caption'>
                              {intl.formatMessage({ id: 'members.roleAdmin' })}
                            </SelectItem>
                            <SelectItem value='MEMBER' className='text-caption'>
                              {intl.formatMessage({
                                id: 'members.roleMember',
                              })}
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        {/* Joined */}
                        <span className='text-body text-muted-foreground shrink-0 whitespace-nowrap'>
                          {formatDate(m.joinedAt, intl.locale)}
                        </span>

                        {/* Actions — expand details, then the member menu */}
                        <div className='flex items-center justify-end'>
                          {isSelf && canLeave ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  aria-label={intl.formatMessage({
                                    id: 'members.memberActions',
                                  })}
                                  className='text-muted-foreground hover:text-foreground shrink-0'
                                >
                                  <MoreHorizontal size={14} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                <DropdownMenuItem
                                  className='cursor-pointer text-danger-text focus:text-danger-text'
                                  onClick={() => setLeaveOpen(true)}
                                >
                                  {intl.formatMessage({
                                    id: 'members.leaveWorkspace',
                                  })}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : isOwner && !isSelf ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  aria-label={intl.formatMessage({
                                    id: 'members.memberActions',
                                  })}
                                  className='text-muted-foreground hover:text-foreground shrink-0'
                                  disabled={removingId === m.id}
                                >
                                  <MoreHorizontal size={14} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                <DropdownMenuItem
                                  className='cursor-pointer text-danger-text focus:text-danger-text'
                                  onClick={() =>
                                    setRemoveTarget({ id: m.id, name: m.name })
                                  }
                                >
                                  {intl.formatMessage({
                                    id: 'members.removeMember',
                                  })}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                          <CollapsibleTrigger asChild>
                            <Button
                              variant='ghost'
                              size='icon'
                              aria-label={intl.formatMessage(
                                {
                                  id: expanded
                                    ? 'members.details.hide'
                                    : 'members.details.show',
                                },
                                { name: m.name }
                              )}
                              className='text-muted-foreground hover:text-foreground shrink-0'
                              disabled={connectionsUnknown}
                            >
                              <ChevronDown
                                size={16}
                                className='transition-transform group-data-[state=open]/collapsible:rotate-180'
                              />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                      </div>

                      <CollapsibleContent>
                        <div className='pl-16 pr-4 pb-5'>
                          <MemberConnectionDetails
                            connections={memberConnections}
                            now={now}
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )
                })}
              </AsyncContent>
            </div>
          </div>
        </section>

        {/* Invited (pending) */}
        {(invites.length > 0 || loadingInvites) && (
          <section>
            <div className='flex items-center gap-2 mb-3'>
              <span className='text-body-strong text-foreground'>
                {intl.formatMessage({ id: 'members.invited' })}
              </span>
              <span className='text-caption text-muted-foreground'>
                {invites.length}
              </span>
            </div>

            <div className='rounded-lg border border-border overflow-hidden'>
              {/* Table header — same columns as Active */}
              <div className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 px-4 py-2 bg-muted border-b border-border'>
                <span className='text-caption text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colName' })}
                </span>
                <span className='text-caption text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colEmail' })}
                </span>
                <span className='text-caption text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colRole' })}
                </span>
                <span className='text-caption text-muted-foreground'>
                  {intl.formatMessage({ id: 'members.colSent' })}
                </span>
                <span />
              </div>

              <AsyncContent
                loading={loadingInvites && invites.length === 0}
                loadingState={
                  <RowListSkeleton
                    rows={2}
                    leading='avatar'
                    rowClassName='px-4 py-3'
                  />
                }
              >
                {invites.map(inv => (
                  <div
                    key={inv.id}
                    className='grid grid-cols-[1fr_1fr_96px_96px_32px] gap-4 items-center px-4 py-3 border-b border-border/50 last:border-0'
                  >
                    {/* Name — show email with avatar (no real name yet) */}
                    <div className='flex items-center gap-2.5 min-w-0'>
                      <div className='size-7 rounded-full bg-muted flex items-center justify-center text-caption font-semibold text-muted-foreground shrink-0 uppercase'>
                        {inv.email[0]}
                      </div>
                      <span className='text-body text-foreground truncate'>
                        {inv.email}
                      </span>
                    </div>

                    {/* Email */}
                    <span className='text-body text-muted-foreground truncate'>
                      {inv.email}
                    </span>

                    {/* Role — always disabled for pending invites */}
                    <Select value='MEMBER' disabled>
                      <SelectTrigger className='h-7 w-24 text-caption border-border'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='MEMBER' className='text-caption'>
                          {intl.formatMessage({ id: 'members.roleMember' })}
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Sent date */}
                    <span className='text-body text-muted-foreground whitespace-nowrap'>
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
                          className='cursor-pointer text-danger-text focus:text-danger-text'
                          onClick={() => setRevokeToken(inv.token)}
                        >
                          {intl.formatMessage({ id: 'members.revokeInvite' })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </AsyncContent>
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
                  className='flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-body outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'
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
                className='text-caption text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1 transition-colors'
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

      {/* ─── Remove member confirm (LUM-906) ─────────────────────────────────── */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={open => {
          if (!open && !removingId) setRemoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage(
                { id: 'members.removeTitle' },
                { name: removeTarget?.name ?? '' }
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'members.removeDesc' },
                { name: removeTarget?.name ?? '' }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!removingId}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={e => {
                e.preventDefault()
                void handleRemove()
              }}
              disabled={!!removingId}
            >
              {removingId
                ? intl.formatMessage({ id: 'members.removing' })
                : intl.formatMessage({ id: 'members.removeMember' })}
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
