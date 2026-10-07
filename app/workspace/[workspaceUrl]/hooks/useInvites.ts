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

/**
 * A single invite-email input row. Carries a stable `id` so React can key the
 * list by identity — keying by array index made removing a middle row reuse the
 * wrong DOM node, leaking focus and values across the surviving rows.
 */
export interface EmailField {
  id: string
  value: string
}

const MAX_EMAIL_FIELDS = 10

/**
 * LUM-1017: which message to show when a resend fails. The resend route
 * answers EMAIL_SEND_FAILED (502) / EMAIL_NOT_CONFIGURED (503) when the email
 * did not go out; anything else falls back to the generic failure.
 */
export function resendErrorMessageId(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null
      ? (err as { code?: unknown }).code
      : undefined
  if (code === 'EMAIL_NOT_CONFIGURED') return 'members.resendEmailNotConfigured'
  if (code === 'EMAIL_SEND_FAILED') return 'members.resendEmailFailed'
  return 'members.resendFailed'
}

const seedEmailFields = (): EmailField[] => [{ id: 'email-0', value: '' }]

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
  const [emailInputs, setEmailInputs] = useState<EmailField[]>(seedEmailFields)
  // Monotonic counter for fresh field ids; bumped only in event handlers, never
  // during render (keeps the hook pure).
  const emailIdRef = useRef(1)
  const [sending, setSending] = useState(false)

  const resetEmails = useCallback(() => {
    emailIdRef.current = 1
    setEmailInputs(seedEmailFields())
  }, [])

  // Revoke confirm
  const [revokeToken, setRevokeToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  // Resend
  const [resendingToken, setResendingToken] = useState<string | null>(null)

  // ─── Send invites ───────────────────────────────────────────────────────────
  const handleSendInvites = async () => {
    const emails = emailInputs.map(f => f.value.trim()).filter(Boolean)
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
      resetEmails()
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
    } catch (err) {
      toast.error(intl.formatMessage({ id: resendErrorMessageId(err) }))
    } finally {
      setResendingToken(null)
    }
  }

  // ─── Email input helpers (keyed by stable id, not array index) ───────────────
  const addEmailField = () => {
    setEmailInputs(prev =>
      prev.length < MAX_EMAIL_FIELDS
        ? [...prev, { id: `email-${emailIdRef.current++}`, value: '' }]
        : prev
    )
  }

  const updateEmail = (id: string, value: string) => {
    setEmailInputs(prev => prev.map(f => (f.id === id ? { ...f, value } : f)))
  }

  const removeEmail = (id: string) => {
    setEmailInputs(prev => {
      const next = prev.filter(f => f.id !== id)
      return next.length === 0 ? seedEmailFields() : next
    })
  }

  return {
    invites: query.data ?? [],
    loadingInvites: query.isFetching && !query.data,
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
  }
}
