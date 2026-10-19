'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { securityScanClient } from '@/ee/security/api-client'
import { queryKeys } from '@/lib/query/keys'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { WorkspaceSecuritySwitches } from '@/ee/security/security-scan/workspace-switches'
import {
  parseLearningsScope,
  type LearningsScope,
} from '@/ee/security/security-scan/learnings-scope'
import { AUTO_PAUSE_AFTER_MAX } from '@/ee/security/security-scan/review-control'

/** LUM-1134 — the order the scope choices are offered in (default first). */
const SCOPE_CHOICES: readonly LearningsScope[] = ['auto', 'local', 'global']

interface SecurityScanSwitchesCardProps {
  initial: WorkspaceSecuritySwitches
  /** False when the platform env turned the hunt off: shown off, locked. */
  huntAvailable: boolean
  /** False when the platform env has the reward-hack layer off: shown off, locked. */
  rewardHackAvailable: boolean
  /**
   * LUM-1025 — false when Vercel Sandbox is not configured on this
   * deployment: the managed scanners and the hunt cannot run, and the notes
   * say so instead of blaming a platform-wide switch.
   */
  sandboxAvailable: boolean
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
        <label htmlFor={id} className='text-body-strong text-foreground'>
          {label}
        </label>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {description}
        </p>
        {note && (
          <p className='text-caption text-muted-foreground mt-1'>{note}</p>
        )}
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

interface ScopeRowProps {
  label: string
  description: string
  value: LearningsScope
  disabled: boolean
  optionLabel: (scope: LearningsScope) => string
  /** Shown while `global` is chosen (the CLI's confirmation, in words). */
  globalWarning: string
  onChange: (next: LearningsScope) => void
}

/** LUM-1134 — which repositories' learnings the AI review reads. */
function ScopeRow({
  label,
  description,
  value,
  disabled,
  optionLabel,
  globalWarning,
  onChange,
}: ScopeRowProps) {
  return (
    <div className='flex flex-col gap-3 px-5 py-4 border-b border-border sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
      <div className='min-w-0 sm:flex-1'>
        <label
          htmlFor='security-learnings-scope'
          className='text-body-strong text-foreground'
        >
          {label}
        </label>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {description}
        </p>
        {value === 'global' && (
          <p
            role='alert'
            data-testid='learnings-scope-global-warning'
            className='mt-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-caption text-warning-text'
          >
            {globalWarning}
          </p>
        )}
      </div>
      <select
        id='security-learnings-scope'
        value={value}
        disabled={disabled}
        onChange={e => onChange(parseLearningsScope(e.target.value))}
        className='h-8 min-w-0 sm:w-56 sm:shrink-0 rounded-md border border-border bg-transparent px-3 text-body text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
      >
        {SCOPE_CHOICES.map(scope => (
          <option key={scope} value={scope}>
            {optionLabel(scope)}
          </option>
        ))}
      </select>
    </div>
  )
}

interface PauseAfterRowProps {
  label: string
  description: string
  value: number
  disabled: boolean
  onChange: (next: number) => void
}

/** A typed pause-after, clamped to 0–100; null while not a number yet. */
function parsePauseAfterInput(raw: string): number | null {
  const next = Number.parseInt(raw, 10)
  if (Number.isNaN(next)) return null
  return Math.min(AUTO_PAUSE_AFTER_MAX, Math.max(0, next))
}

/**
 * LUM-1137 — pause automatic review after N reviewed commits (0 = never).
 * The field keeps its own text so it can be cleared while typing; only a
 * number reaches `onChange`, and leaving the field shows the saved value.
 */
function PauseAfterRow({
  label,
  description,
  value,
  disabled,
  onChange,
}: PauseAfterRowProps) {
  // Text that is not a number yet (e.g. cleared while typing); null shows
  // `value`.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className='flex flex-col gap-3 px-5 py-4 border-b border-border sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
      <div className='min-w-0 sm:flex-1'>
        <label
          htmlFor='security-review-auto-pause-after'
          className='text-body-strong text-foreground'
        >
          {label}
        </label>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {description}
        </p>
      </div>
      <input
        id='security-review-auto-pause-after'
        type='number'
        inputMode='numeric'
        min={0}
        max={AUTO_PAUSE_AFTER_MAX}
        step={1}
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={e => {
          const next = parsePauseAfterInput(e.target.value)
          setDraft(next === null ? e.target.value : null)
          if (next !== null) onChange(next)
        }}
        onBlur={() => setDraft(null)}
        className='h-8 w-24 shrink-0 rounded-md border border-border bg-transparent px-3 text-body text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
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
  huntAvailable,
  rewardHackAvailable,
  sandboxAvailable,
}: SecurityScanSwitchesCardProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [switches, setSwitches] = useState<WorkspaceSecuritySwitches>(initial)
  const [saving, setSaving] = useState(false)
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.securityScan.${id}` })

  const set =
    (
      key: Exclude<
        keyof WorkspaceSecuritySwitches,
        'securityLearningsScope' | 'securityReviewAutoPauseAfter'
      >
    ) =>
    (next: boolean) =>
      setSwitches(prev => ({ ...prev, [key]: next }))

  const save = async (
    update: Parameters<typeof securityScanClient.updateSecurityScan>[0],
    successId: string
  ) => {
    setSaving(true)
    try {
      const next = await securityScanClient.updateSecurityScan(update)
      setSwitches(next.switches)
      // LUM-1114: the AI review switch decides which rules are checked.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspacePolicyCoverage(),
      })
      toast.success(t(successId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => save(switches, 'updated')

  // LUM-1002: one click to turn every switch off (or back on), saved at once.
  const allOff =
    !switches.securityScanEnabled &&
    !switches.securityAiReviewEnabled &&
    !switches.securityHuntEnabled &&
    !switches.securityRewardHackEnabled
  const handleToggleAll = () =>
    save({ all: allOff }, allOff ? 'allEnabled' : 'allDisabled')

  const scanOn = switches.securityScanEnabled
  const platformNote = t(
    sandboxAvailable ? 'platformOff' : 'sandboxUnavailable'
  )

  return (
    <div className='rounded-lg border border-border overflow-hidden mb-8'>
      <div className='flex items-start justify-between gap-4 px-5 py-3 border-b border-border'>
        <div>
          <p className='text-body-strong text-foreground'>{t('title')}</p>
          <p className='text-caption text-muted-foreground mt-0.5'>
            {t('description')}
          </p>
        </div>
        <Button
          size='sm'
          variant='outline'
          onClick={handleToggleAll}
          disabled={saving}
        >
          {t(allOff ? 'enableAll' : 'disableAll')}
        </Button>
      </div>

      <SwitchRow
        id='security-scan-enabled'
        label={t('scan.label')}
        description={t('scan.description')}
        checked={scanOn}
        disabled={saving}
        note={sandboxAvailable ? undefined : t('scan.sandboxUnavailable')}
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
        checked={scanOn && huntAvailable && switches.securityHuntEnabled}
        disabled={saving || !scanOn || !huntAvailable}
        note={huntAvailable ? undefined : platformNote}
        onChange={set('securityHuntEnabled')}
      />
      {/* LUM-1234: agent behavior — reads the agent sessions behind the PR.
          Needs no sandbox, so the note is always the platform one. */}
      <SwitchRow
        id='security-reward-hack-enabled'
        label={t('rewardHack.label')}
        description={t('rewardHack.description')}
        checked={
          scanOn && rewardHackAvailable && switches.securityRewardHackEnabled
        }
        disabled={saving || !scanOn || !rewardHackAvailable}
        note={rewardHackAvailable ? undefined : t('platformOff')}
        onChange={set('securityRewardHackEnabled')}
      />
      {/* LUM-1130: not a layer — how Lumo's review reads on the PR. Off by
          default; "enable all" / "disable all" leave it as it is. */}
      <SwitchRow
        id='security-request-changes-enabled'
        label={t('requestChanges.label')}
        description={t('requestChanges.description')}
        checked={scanOn && switches.securityRequestChangesEnabled}
        disabled={saving || !scanOn}
        onChange={set('securityRequestChangesEnabled')}
      />
      {/* LUM-1142: author approval — who may run
          `@uselumo resolve` / `approve`. On by default; "enable all" /
          "disable all" leave it as it is. */}
      <SwitchRow
        id='security-allow-author-approval'
        label={t('allowAuthorApproval.label')}
        description={t('allowAuthorApproval.description')}
        checked={scanOn && switches.securityAllowAuthorApproval}
        disabled={saving || !scanOn}
        onChange={set('securityAllowAuthorApproval')}
      />
      {/* LUM-1134: learnings only shape the AI review — locked while it is
          off. Saved with the switches; "enable all" / "disable all" leave
          it as it is. */}
      <ScopeRow
        label={t('learningsScope.label')}
        description={t('learningsScope.description')}
        value={switches.securityLearningsScope}
        disabled={saving || !scanOn || !switches.securityAiReviewEnabled}
        optionLabel={scope => t(`learningsScope.${scope}`)}
        globalWarning={t('learningsScope.globalWarning')}
        onChange={next =>
          setSwitches(prev => ({ ...prev, securityLearningsScope: next }))
        }
      />
      {/* LUM-1137: auto-pause after reviewed commits — every
          push is reviewed until N reviewed commits; 0 = never pause. Locked
          while neither AI layer runs. */}
      <PauseAfterRow
        label={t('autoPauseAfter.label')}
        description={t('autoPauseAfter.description')}
        value={switches.securityReviewAutoPauseAfter}
        disabled={
          saving ||
          !scanOn ||
          (!switches.securityAiReviewEnabled && !switches.securityHuntEnabled)
        }
        onChange={next =>
          setSwitches(prev => ({
            ...prev,
            securityReviewAutoPauseAfter: next,
          }))
        }
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
