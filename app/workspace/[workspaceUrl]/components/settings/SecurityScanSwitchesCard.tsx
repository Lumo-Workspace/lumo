'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type {
  PlatformSecurityCeiling,
  WorkspaceSecuritySwitches,
} from '@/lib/security-scan/workspace-switches'

interface SecurityScanSwitchesCardProps {
  initial: WorkspaceSecuritySwitches
  /** Layers the platform env allows at all; an off one is shown off, locked. */
  platform: PlatformSecurityCeiling
}

interface SwitchRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  note?: string | undefined
  onChange: (next: boolean) => void
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  note,
  onChange,
}: SwitchRowProps) {
  return (
    <div className='flex items-start justify-between gap-4 px-5 py-4 border-b border-border'>
      <div>
        <label htmlFor={id} className='text-sm font-medium text-foreground'>
          {label}
        </label>
        <p className='text-xs text-muted-foreground mt-0.5'>{description}</p>
        {note && <p className='text-xs text-muted-foreground mt-1'>{note}</p>}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}

/**
 * LUM-866 — OWNER-only switches for the PR security scan: the whole scan, the
 * AI review (LLM judge) and the exploit-path hunt. The scan switch is the
 * master; a layer the platform turned off reads off and cannot be enabled.
 */
export function SecurityScanSwitchesCard({
  initial,
  platform,
}: SecurityScanSwitchesCardProps) {
  const intl = useIntl()
  const [switches, setSwitches] = useState<WorkspaceSecuritySwitches>(initial)
  const [saving, setSaving] = useState(false)
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.securityScan.${id}` })

  const set = (key: keyof WorkspaceSecuritySwitches) => (next: boolean) =>
    setSwitches(prev => ({ ...prev, [key]: next }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await workspacesClient.updateMe(switches)
      toast.success(t('updated'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  const scanOn = switches.securityScanEnabled
  const platformNote = t('platformOff')

  return (
    <div className='rounded-lg border border-border overflow-hidden mb-8'>
      <div className='px-5 py-3 border-b border-border'>
        <p className='text-sm font-semibold text-foreground'>{t('title')}</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          {t('description')}
        </p>
      </div>

      <SwitchRow
        id='security-scan-enabled'
        label={t('scan.label')}
        description={t('scan.description')}
        checked={scanOn}
        disabled={saving}
        onChange={set('securityScanEnabled')}
      />
      <SwitchRow
        id='security-ai-review-enabled'
        label={t('aiReview.label')}
        description={t('aiReview.description')}
        checked={scanOn && switches.securityAiReviewEnabled}
        disabled={saving || !scanOn}
        onChange={set('securityAiReviewEnabled')}
      />
      <SwitchRow
        id='security-hunt-enabled'
        label={t('hunt.label')}
        description={t('hunt.description')}
        checked={scanOn && platform.hunt && switches.securityHuntEnabled}
        disabled={saving || !scanOn || !platform.hunt}
        note={platform.hunt ? undefined : platformNote}
        onChange={set('securityHuntEnabled')}
      />

      <div className='flex justify-end px-5 py-4'>
        <Button size='sm' onClick={handleSave} disabled={saving}>
          {saving
            ? intl.formatMessage({ id: 'common.saving' })
            : intl.formatMessage({ id: 'common.save' })}
        </Button>
      </div>
    </div>
  )
}
