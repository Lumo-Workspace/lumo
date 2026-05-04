'use client'

import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { API } from '../constants'
import { apiFetch, workspacesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

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
  const queryClient = useQueryClient()

  const query = useQuery<PendingInvite[]>({
    queryKey: queryKeys.invites(),
    queryFn: async () => {
      const data = await apiFetch<{ invites: PendingInvite[] }>(
        API.invites.list
      )
      return data.invites
    },
    enabled: false,
  })

  const queryRef = useRef(query)
  queryRef.current = query

  const fetchInvites = useCallback(async () => {
    await queryRef.current.refetch()
  }, [])

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [emailInputs, setEmailInputs] = useState([''])
  const [sending, setSending] = useState(false)

  // Revoke confirm
  const [revokeToken, setRevokeToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  // Resend
  const [resendingToken, setResendingToken] = useState<string | null>(null)

  // ─── Send invites ───────────────────────────────────────────────────────────
  const handleSendInvites = async () => {
    const emails = emailInputs.map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) return

    setSending(true)
    try {
      const wsData = await workspacesClient.getMe<{
        workspace: { id: string }
      }>()
      const workspaceId = wsData.workspace.id

      const data = await apiFetch<{ sent: number; failed?: string[] }>(
        API.invites.list,
        {
          method: 'POST',
          body: { emails, workspaceId },
        }
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
      await apiFetch<void>(API.invites.byToken(revokeToken), {
        method: 'DELETE',
      })
      queryClient.setQueryData<PendingInvite[]>(queryKeys.invites(), prev =>
        (prev ?? []).filter(i => i.token !== revokeToken)
      )
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
      await apiFetch<void>(API.invites.resend(token), { method: 'POST' })
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
    invites: query.data ?? [],
    loadingInvites: query.isFetching && !query.data,
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
