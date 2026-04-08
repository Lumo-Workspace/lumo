'use client'

import { useState, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { readCache, writeCache } from '../cache'
import { API, CACHE_KEY } from '../constants'
import { apiFetch } from '../utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PendingInvite {
  id: string
  token: string
  email: string
  inviterName: string
  expiresAt: string
  createdAt: string
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInvites() {
  const intl = useIntl()
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loadingInvites, setLoadingInvites] = useState(true)

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [emailInputs, setEmailInputs] = useState([''])
  const [sending, setSending] = useState(false)

  // Revoke confirm
  const [revokeToken, setRevokeToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  // Resend
  const [resendingToken, setResendingToken] = useState<string | null>(null)

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

  // ─── Send invites ───────────────────────────────────────────────────────────
  const handleSendInvites = async () => {
    const emails = emailInputs.map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) return

    setSending(true)
    try {
      const wsRes = await fetch('/api/workspaces/me')
      if (!wsRes.ok) throw new Error('Could not fetch workspace')
      const wsData = await wsRes.json()
      const workspaceId = wsData.workspace.id

      const res = await apiFetch(API.invites.list, {
        method: 'POST',
        body: { emails, workspaceId },
      })
      const data = await res.json()
      if (!res.ok)
        throw new Error(
          data.error ?? intl.formatMessage({ id: 'members.inviteFailed' })
        )

      toast.success(
        intl.formatMessage({ id: 'members.invitesSent' }, { count: data.sent }),
        data.failed?.length
          ? { description: `Failed: ${data.failed.join(', ')}` }
          : undefined
      )
      setInviteOpen(false)
      setEmailInputs([''])
      await fetchInvites()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'members.inviteFailed' })
      )
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
      if (!res.ok)
        throw new Error(intl.formatMessage({ id: 'members.revokeFailed' }))
      setInvites(prev => {
        const next = prev.filter(i => i.token !== revokeToken)
        writeCache(CACHE_KEY.invites, next)
        return next
      })
      toast.success(intl.formatMessage({ id: 'members.revokeSuccess' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'members.revokeFailed' }))
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
      if (!res.ok)
        throw new Error(intl.formatMessage({ id: 'members.resendFailed' }))
      toast.success(intl.formatMessage({ id: 'members.resendSuccess' }))
      await fetchInvites()
    } catch {
      toast.error(intl.formatMessage({ id: 'members.resendFailed' }))
    } finally {
      setResendingToken(null)
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

  return {
    invites,
    loadingInvites,
    inviteOpen,
    setInviteOpen,
    emailInputs,
    setEmailInputs,
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
  }
}
