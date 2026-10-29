'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { securityScanClient } from '@/ee/security/api-client'
import { queryKeys } from '@/lib/query/keys'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { WorkspaceSecuritySwitches } from '@/ee/security/security-scan/workspace-switches'
import {
  parseLearningsScope,
  type LearningsScope,
} from '@/ee/security/security-scan/learnings-scope'
import { AUTO_PAUSE_AFTER_MAX } from '@/ee/security/security-scan/review-control'
import {
  AGENT_REVIEW_BLOCKING_LEVELS,
  type AgentReviewBlocking,
  type AgentReviewBlockingView,
} from '@/ee/security/security-scan/policy'

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
  /** LUM-1329 — which imported agent-review findings block Done. */
  initialAgentReviewBlocking: AgentReviewBlockingView
}

/** LUM-1327 — a sub-heading splitting the card's rows into groups. */
function GroupLabel({ children }: { children: string }) {
  return (
    <p className='px-5 py-2 bg-muted text-caption text-muted-foreground border-b border-border'>
      {children}
    </p>
  )
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
    <div className='flex items-start justify-between gap-4 px-5 py-4 border-b border-border last:border-b-0'>
      <div className='min-w-0'>
        <Label htmlFor={id} className='text-body-strong text-foreground'>
          {label}
        </Label>
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
    <div className='flex flex-col gap-3 px-5 py-4 border-b border-border last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
      <div className='min-w-0 sm:flex-1'>
        <Label
          htmlFor='security-learnings-scope'
          className='text-body-strong text-foreground'
        >
          {label}
        </Label>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {description}
        </p>
        {value === 'global' && (
          <Alert
            variant='warning'
            size='sm'
            data-testid='learnings-scope-global-warning'
            className='mt-2'
          >
            <AlertTriangle />
            <AlertDescription>{globalWarning}</AlertDescription>
          </Alert>
        )}
      </div>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={v => onChange(parseLearningsScope(v))}
      >
        <SelectTrigger
          id='security-learnings-scope'
          className='h-8 min-w-0 sm:w-56 sm:shrink-0 text-foreground'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCOPE_CHOICES.map(scope => (
            <SelectItem key={scope} value={scope}>
              {optionLabel(scope)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

interface AgentReviewRowProps {
  label: string
  description: string
  value: AgentReviewBlockingView
  disabled: boolean
  optionLabel: (level: AgentReviewBlockingView) => string
  /** Shown while any level blocks (the CLI's confirmation, in words). */
  blockingWarning: string
  onChange: (next: AgentReviewBlocking) => void
}

/**
 * LUM-1329 — the policy's AGENT_REVIEW entries as one choice: off, or the
 * lowest severity of an imported agent-review finding that blocks Done. A
 * set written through the raw API that is no single level shows as
 * `custom` until the owner picks one.
 */
function AgentReviewRow({
  label,
  description,
  value,
  disabled,
  optionLabel,
  blockingWarning,
  onChange,
}: AgentReviewRowProps) {
  const choices: AgentReviewBlockingView[] =
    value === 'custom'
      ? [...AGENT_REVIEW_BLOCKING_LEVELS, 'custom']
      : [...AGENT_REVIEW_BLOCKING_LEVELS]
  return (
    <div className='flex flex-col gap-3 px-5 py-4 border-b border-border sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
      <div className='min-w-0 sm:flex-1'>
        <Label
          htmlFor='security-agent-review-blocking'
          className='text-body-strong text-foreground'
        >
          {label}
        </Label>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {description}
        </p>
        {value !== 'off' && (
          <Alert
            variant='warning'
            size='sm'
            data-testid='agent-review-blocking-warning'
            className='mt-2'
          >
            <AlertTriangle />
            <AlertDescription>{blockingWarning}</AlertDescription>
          </Alert>
        )}
      </div>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={v => {
          const level = AGENT_REVIEW_BLOCKING_LEVELS.find(l => l === v)
          if (level) onChange(level)
        }}
      >
        <SelectTrigger
          id='security-agent-review-blocking'
          className='h-8 min-w-0 sm:w-56 sm:shrink-0 text-foreground'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map(level => (
            <SelectItem key={level} value={level} disabled={level === 'custom'}>
              {optionLabel(level)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
    <div className='flex flex-col gap-3 px-5 py-4 border-b border-border last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
      <div className='min-w-0 sm:flex-1'>
        <Label
          htmlFor='security-review-auto-pause-after'
          className='text-body-strong text-foreground'
        >
          {label}
        </Label>
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
  initialAgentReviewBlocking,
}: SecurityScanSwitchesCardProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [switches, setSwitches] = useState<WorkspaceSecuritySwitches>(initial)
  // LUM-1327: what the server holds — Save shows only when they differ.
  const [saved, setSaved] = useState<WorkspaceSecuritySwitches>(initial)
  // LUM-1329: the agent-review level, and the one the server holds. A save
  // sends it only when the owner changed it, so an unrelated save never
  // undoes a newer level set elsewhere (e.g. from the CLI).
  const [agentReview, setAgentReview] = useState<AgentReviewBlockingView>(
    initialAgentReviewBlocking
  )
  const [savedAgentReview, setSavedAgentReview] =
    useState<AgentReviewBlockingView>(initialAgentReviewBlocking)
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

  const agentReviewChanged =
    agentReview !== savedAgentReview && agentReview !== 'custom'
  const dirty =
    agentReviewChanged ||
    (Object.keys(switches) as (keyof WorkspaceSecuritySwitches)[]).some(
      key => switches[key] !== saved[key]
    )

  const handleSave = async () => {
    setSaving(true)
    try {
      const next = await securityScanClient.updateSecurityScan(
        agentReviewChanged
          ? { ...switches, agentReviewBlocking: agentReview }
          : switches
      )
      setSwitches(next.switches)
      setSaved(next.switches)
      setAgentReview(next.agentReviewBlocking)
      setSavedAgentReview(next.agentReviewBlocking)
      // LUM-1114: the AI review switch decides which rules are checked.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspacePolicyCoverage(),
      })
      toast.success(t('updated'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  // LUM-1327: the scan switch is the card's master — every row below needs
  // it — so it sits in the header like the other switches, replacing the
  // old "Disable all" button.
  const scanOn = switches.securityScanEnabled
  const platformNote = t(
    sandboxAvailable ? 'platformOff' : 'sandboxUnavailable'
  )

  return (
    <div className='rounded-lg border border-border overflow-hidden mb-8'>
      <div className='flex items-start justify-between gap-4 px-5 py-3 border-b border-border'>
        <div className='min-w-0'>
          <Label
            htmlFor='security-scan-enabled'
            className='text-body-strong text-foreground'
          >
            {t('title')}
          </Label>
          <p className='text-caption text-muted-foreground mt-0.5'>
            {t('description')}
          </p>
          {!sandboxAvailable && (
            <p className='text-caption text-muted-foreground mt-1'>
              {t('scan.sandboxUnavailable')}
            </p>
          )}
        </div>
        <Switch
          id='security-scan-enabled'
          checked={scanOn}
          disabled={saving}
          onCheckedChange={set('securityScanEnabled')}
        />
      </div>

      <GroupLabel>{t('group.checks')}</GroupLabel>
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

      <GroupLabel>{t('group.behavior')}</GroupLabel>
      {/* LUM-1130: not a layer — how Lumo's review reads on the PR. Off by
          default. */}
      <SwitchRow
        id='security-request-changes-enabled'
        label={t('requestChanges.label')}
        description={t('requestChanges.description')}
        checked={scanOn && switches.securityRequestChangesEnabled}
        disabled={saving || !scanOn}
        onChange={set('securityRequestChangesEnabled')}
      />
      {/* LUM-1142: author approval — who may run
          `@uselumo resolve` / `approve`. On by default. */}
      <SwitchRow
        id='security-allow-author-approval'
        label={t('allowAuthorApproval.label')}
        description={t('allowAuthorApproval.description')}
        checked={scanOn && switches.securityAllowAuthorApproval}
        disabled={saving || !scanOn}
        onChange={set('securityAllowAuthorApproval')}
      />
      {/* LUM-1134: learnings only shape the AI review — locked while it is
          off. */}
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
      {/* LUM-1329: not a layer — whether a developer's imported Claude
          Code / Codex findings block Done. Off by default. */}
      <AgentReviewRow
        label={t('agentReviewBlocking.label')}
        description={t('agentReviewBlocking.description')}
        value={agentReview}
        disabled={saving}
        optionLabel={level => t(`agentReviewBlocking.${level}`)}
        blockingWarning={t('agentReviewBlocking.warning')}
        onChange={setAgentReview}
      />

      {dirty && (
        <div className='flex justify-end px-5 py-3'>
          <Button size='sm' onClick={handleSave} disabled={saving}>
            {saving
              ? intl.formatMessage({ id: 'common.saving' })
              : intl.formatMessage({ id: 'common.save' })}
          </Button>
        </div>
      )}
    </div>
  )
}
