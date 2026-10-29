'use client'

import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { CircleAlert } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAiFeatures, useSetAiFeature } from '@/hooks/use-ai-features'
import {
  AI_FEATURES,
  AI_FEATURE_GROUPS,
  switchOn,
  type AiFeature,
  type AiFeatureSwitches,
  type AiSwitchKey,
} from '@/lib/ai-features/registry'
import { RowListSkeleton } from '../skeletons/RowListSkeleton'

interface SwitchRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  level: 'master' | 'group' | 'feature'
  onChange: (enabled: boolean) => void
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  level,
  onChange,
}: SwitchRowProps) {
  const indent = level === 'feature' ? 'pl-10' : 'pl-5'
  const labelClass =
    level === 'feature'
      ? 'text-body text-foreground'
      : 'text-body-strong text-foreground'
  return (
    <div
      data-testid={`ai-switch-${id}`}
      className={`flex items-center justify-between gap-4 border-b border-border py-3 pr-5 last:border-b-0 ${indent}`}
    >
      <div className='min-w-0'>
        <label htmlFor={`ai-switch-input-${id}`} className={labelClass}>
          {label}
        </label>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {description}
        </p>
      </div>
      <Switch
        id={`ai-switch-input-${id}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  )
}

/**
 * LUM-1338 — the workspace's AI feature switches: the master switch, one per
 * group, one per feature. Without a model on the deployment the master switch
 * is off and cannot be turned on; the note says how to configure one. While a
 * parent is off its children show off and are disabled; their own positions
 * are kept and come back when the parent is turned on again.
 */
export function AiFeaturesSection() {
  const intl = useIntl()
  const { status, isLoading, error } = useAiFeatures()
  const setFeature = useSetAiFeature()

  if (error && !status)
    return (
      <Alert variant='danger' data-testid='ai-features-load-failed'>
        <CircleAlert />
        <AlertDescription>
          {intl.formatMessage({ id: 'aiFeatures.loadFailed' })}
        </AlertDescription>
      </Alert>
    )
  if (isLoading || !status) return <RowListSkeleton rows={4} />

  const { aiConfigured, switches, available } = status
  const masterOn = aiConfigured && switchOn(switches, { level: 'master' })
  const saving = setFeature.isPending

  const set = (key: AiSwitchKey, enabled: boolean) => {
    setFeature.mutate(
      { key, enabled },
      {
        onError: () =>
          toast.error(intl.formatMessage({ id: 'aiFeatures.saveFailed' })),
      }
    )
  }

  const groups = AI_FEATURE_GROUPS.map(group => ({
    group,
    features: available.filter(f => AI_FEATURES[f] === group),
  })).filter(g => g.features.length > 0)

  return (
    <div className='space-y-3'>
      {!aiConfigured && (
        <Alert variant='warning' data-testid='ai-features-not-configured'>
          <CircleAlert />
          <AlertDescription>
            {intl.formatMessage({ id: 'aiFeatures.notConfigured' })}
          </AlertDescription>
        </Alert>
      )}
      <div className='rounded-lg border border-border overflow-hidden'>
        <SwitchRow
          id='master'
          level='master'
          label={intl.formatMessage({ id: 'aiFeatures.master.label' })}
          description={intl.formatMessage({
            id: 'aiFeatures.master.description',
          })}
          checked={masterOn}
          disabled={!aiConfigured || saving}
          onChange={enabled => set({ level: 'master' }, enabled)}
        />
        {groups.map(({ group, features }) => (
          <GroupRows
            key={group}
            group={group}
            features={features}
            switches={switches}
            parentOn={masterOn}
            saving={saving}
            onSet={set}
          />
        ))}
      </div>
    </div>
  )
}

interface GroupRowsProps {
  group: (typeof AI_FEATURE_GROUPS)[number]
  features: AiFeature[]
  switches: AiFeatureSwitches
  parentOn: boolean
  saving: boolean
  onSet: (key: AiSwitchKey, enabled: boolean) => void
}

function GroupRows({
  group,
  features,
  switches,
  parentOn,
  saving,
  onSet,
}: GroupRowsProps) {
  const intl = useIntl()
  const groupOn = switchOn(switches, { level: 'group', key: group })
  return (
    <>
      <SwitchRow
        id={`group-${group}`}
        level='group'
        label={intl.formatMessage({ id: `aiFeatures.group.${group}` })}
        description={intl.formatMessage({
          id: `aiFeatures.group.${group}.description`,
        })}
        checked={parentOn && groupOn}
        disabled={!parentOn || saving}
        onChange={enabled => onSet({ level: 'group', key: group }, enabled)}
      />
      {features.map(feature => (
        <SwitchRow
          key={feature}
          id={`feature-${feature}`}
          level='feature'
          label={intl.formatMessage({ id: `aiFeatures.feature.${feature}` })}
          description={intl.formatMessage({
            id: `aiFeatures.feature.${feature}.description`,
          })}
          checked={
            parentOn &&
            groupOn &&
            switchOn(switches, { level: 'feature', key: feature })
          }
          disabled={!parentOn || !groupOn || saving}
          onChange={enabled =>
            onSet({ level: 'feature', key: feature }, enabled)
          }
        />
      ))}
    </>
  )
}
