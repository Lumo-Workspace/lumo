'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

interface Workspace {
  verificationMaxRounds?: number
  acceptanceMode?: boolean
}

const DEFAULT_VERIFICATION_MAX_ROUNDS = 3

/**
 * Acceptance settings (LUM-434): the per-workspace controls for the acceptance
 * system, split out of the general workspace settings page into their own
 * OWNER-only section — the machine-verification round cap (LUM-429) and the
 * acceptance-mode toggle (LUM-431). Behavior is unchanged from when these cards
 * lived on WorkspaceSettingsPage; this is purely an information-architecture
 * move so the growing acceptance domain has its own home.
 */
export function AcceptanceSettingsPage() {
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()

  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)

  // Machine verification round cap (LUM-429)
  const [verificationMaxRounds, setVerificationMaxRounds] = useState(
    DEFAULT_VERIFICATION_MAX_ROUNDS
  )
  const [savingVerification, setSavingVerification] = useState(false)

  // Acceptance-mode toggle (LUM-431) — default OFF (ritual layer suppressed)
  const [acceptanceMode, setAcceptanceMode] = useState(false)
  const [savingAcceptanceMode, setSavingAcceptanceMode] = useState(false)

  const fetchWorkspace = useCallback(async () => {
    try {
      const data = await workspacesClient.getMe<{
        workspace: Workspace
        role: string
      }>()
      const owner = data.role === 'OWNER'
      setIsOwner(owner)
      setVerificationMaxRounds(
        data.workspace.verificationMaxRounds ?? DEFAULT_VERIFICATION_MAX_ROUNDS
      )
      setAcceptanceMode(data.workspace.acceptanceMode ?? false)
      if (!owner) {
        router.replace(`/workspace/${workspaceUrl}/settings/members`)
      }
    } finally {
      setLoading(false)
    }
  }, [router, workspaceUrl])

  useEffect(() => {
    fetchWorkspace()
  }, [fetchWorkspace])

  // ─── Save machine verification round cap (LUM-429) ───────────────────────
  const handleSaveVerificationCap = async () => {
    setSavingVerification(true)
    try {
      await workspacesClient.updateMe<{ workspace: Workspace }>({
        verificationMaxRounds,
      })
      toast.success(
        intl.formatMessage({ id: 'workspaceSettings.verificationUpdated' })
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'workspaceSettings.verificationUpdateFailed',
            })
      )
    } finally {
      setSavingVerification(false)
    }
  }

  // ─── Toggle acceptance mode (LUM-431) ────────────────────────────────────
  const handleToggleAcceptanceMode = async () => {
    const next = !acceptanceMode
    setAcceptanceMode(next)
    setSavingAcceptanceMode(true)
    try {
      await workspacesClient.updateMe<{ workspace: Workspace }>({
        acceptanceMode: next,
      })
      toast.success(
        intl.formatMessage({ id: 'workspaceSettings.acceptanceModeUpdated' })
      )
    } catch (err) {
      setAcceptanceMode(!next) // revert optimistic flip
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'workspaceSettings.acceptanceModeUpdateFailed',
            })
      )
    } finally {
      setSavingAcceptanceMode(false)
    }
  }

  if (loading) {
    return (
      <div className='h-full flex items-center justify-center'>
        <span className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </span>
      </div>
    )
  }

  if (!isOwner) return null

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-8'>
          {intl.formatMessage({ id: 'acceptanceSettings.title' })}
        </h1>

        {/* Acceptance mode toggle (LUM-431) */}
        <div className='rounded-lg border border-border overflow-hidden mb-8'>
          <div className='flex items-center justify-between gap-4 px-5 py-4'>
            <div>
              <p className='text-sm font-semibold text-foreground'>
                {intl.formatMessage({ id: 'workspaceSettings.acceptanceMode' })}
              </p>
              <p className='text-xs text-muted-foreground mt-0.5'>
                {intl.formatMessage({
                  id: 'workspaceSettings.acceptanceMode.description',
                })}
              </p>
            </div>
            <button
              type='button'
              role='switch'
              aria-checked={acceptanceMode}
              aria-label={intl.formatMessage({
                id: 'workspaceSettings.acceptanceMode',
              })}
              onClick={handleToggleAcceptanceMode}
              disabled={savingAcceptanceMode}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                acceptanceMode ? 'bg-primary' : 'bg-input'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-card shadow-elevation-3 transition-transform ${
                  acceptanceMode ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Machine verification round cap (LUM-429) */}
        <div className='rounded-lg border border-border overflow-hidden mb-8'>
          <div className='px-5 py-3 border-b border-border'>
            <p className='text-sm font-semibold text-foreground'>
              {intl.formatMessage({ id: 'workspaceSettings.verification' })}
            </p>
            <p className='text-xs text-muted-foreground mt-0.5'>
              {intl.formatMessage({
                id: 'workspaceSettings.verification.description',
              })}
            </p>
          </div>

          <div className='flex items-center justify-between gap-4 px-5 py-3 border-b border-border'>
            <label className='text-sm font-medium text-foreground'>
              {intl.formatMessage({
                id: 'workspaceSettings.verification.maxRounds',
              })}
            </label>
            <input
              type='number'
              min={1}
              max={10}
              step={1}
              value={verificationMaxRounds}
              onChange={e => {
                const parsed = parseInt(e.target.value, 10)
                setVerificationMaxRounds(prev =>
                  isNaN(parsed) ? prev : parsed
                )
              }}
              disabled={savingVerification}
              className='w-24 h-8 rounded-md border border-border bg-transparent px-2 text-sm text-right text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
            />
          </div>

          <div className='flex justify-end px-5 py-4'>
            <Button
              size='sm'
              onClick={handleSaveVerificationCap}
              disabled={savingVerification}
            >
              {savingVerification
                ? intl.formatMessage({ id: 'common.saving' })
                : intl.formatMessage({ id: 'common.save' })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
