'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { projectsClient } from '@/lib/api-client/projects'
import { toast } from 'sonner'

interface RiskDefaults {
  riskOverdueRatio: number
  riskStalledDays: number
  riskStalledMinCount: number
  riskAgentFailRatio: number
  riskStalePrDays: number
  riskThroughputDrop: number
}

interface ProjectRiskOverrides {
  riskOverdueRatio: number | null
  riskStalledDays: number | null
  riskStalledMinCount: number | null
  riskAgentFailRatio: number | null
  riskStalePrDays: number | null
  riskThroughputDrop: number | null
}

interface ProjectRiskOverrideCardProps {
  projectId: string
  workspaceDefaults: RiskDefaults
  initialOverrides: ProjectRiskOverrides
}

type FieldKey = keyof ProjectRiskOverrides
type FieldState = { value: string; dirty: boolean }

const FIELDS: Array<{
  key: FieldKey
  labelId: string
  kind: 'int' | 'number'
}> = [
  {
    key: 'riskOverdueRatio',
    labelId: 'summary.riskThresholds.overdueRatio',
    kind: 'number',
  },
  {
    key: 'riskStalledDays',
    labelId: 'summary.riskThresholds.stalledDays',
    kind: 'int',
  },
  {
    key: 'riskStalledMinCount',
    labelId: 'summary.riskThresholds.stalledMinCount',
    kind: 'int',
  },
  {
    key: 'riskAgentFailRatio',
    labelId: 'summary.riskThresholds.agentFailRatio',
    kind: 'number',
  },
  {
    key: 'riskStalePrDays',
    labelId: 'summary.riskThresholds.stalePrDays',
    kind: 'int',
  },
  {
    key: 'riskThroughputDrop',
    labelId: 'summary.riskThresholds.throughputDrop',
    kind: 'number',
  },
]

function initialState(
  overrides: ProjectRiskOverrides
): Record<FieldKey, FieldState> {
  return Object.fromEntries(
    FIELDS.map(f => [
      f.key,
      {
        value: overrides[f.key] === null ? '' : String(overrides[f.key]),
        dirty: false,
      },
    ])
  ) as Record<FieldKey, FieldState>
}

export function ProjectRiskOverrideCard({
  projectId,
  workspaceDefaults,
  initialOverrides,
}: ProjectRiskOverrideCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(() =>
    FIELDS.some(f => initialOverrides[f.key] !== null)
  )
  const [form, setForm] = useState<Record<FieldKey, FieldState>>(() =>
    initialState(initialOverrides)
  )
  const [saving, setSaving] = useState(false)

  const update = (key: FieldKey, value: string) =>
    setForm(f => ({ ...f, [key]: { value, dirty: true } }))

  const resetAll = () =>
    setForm(
      Object.fromEntries(
        FIELDS.map(f => [f.key, { value: '', dirty: true }])
      ) as Record<FieldKey, FieldState>
    )

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Record<string, number | null> = {}
      for (const f of FIELDS) {
        const entry = form[f.key]
        if (!entry.dirty) continue
        if (entry.value === '') {
          payload[f.key] = null
        } else {
          payload[f.key] =
            f.kind === 'int'
              ? parseInt(entry.value, 10)
              : parseFloat(entry.value)
        }
      }
      if (Object.keys(payload).length > 0) {
        await projectsClient.update(projectId, payload)
      }
      // Reset dirty flags
      setForm(
        prev =>
          Object.fromEntries(
            FIELDS.map(f => [f.key, { value: prev[f.key].value, dirty: false }])
          ) as Record<FieldKey, FieldState>
      )
      toast.success(intl.formatMessage({ id: 'summary.riskThresholds.saved' }))
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'summary.riskThresholds.saveFailed' })
      )
    } finally {
      setSaving(false)
    }
  }

  if (!expanded) {
    return (
      <div className='rounded-lg border border-border p-4 space-y-2'>
        <p className='text-xs font-semibold text-foreground'>
          {intl.formatMessage({ id: 'summary.riskThresholds' })}
        </p>
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'summary.riskThresholds.usingDefaults' })}
        </p>
        <button
          type='button'
          onClick={() => setExpanded(true)}
          className='text-xs text-indigo-600 dark:text-indigo-400 hover:underline'
        >
          {intl.formatMessage({
            id: 'summary.riskThresholds.overrideDefaults',
          })}
        </button>
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-border p-4 space-y-3'>
      <p className='text-xs font-semibold text-foreground'>
        {intl.formatMessage({ id: 'summary.riskThresholds' })}
      </p>
      <div className='space-y-2'>
        {FIELDS.map(f => (
          <div key={f.key} className='flex items-center justify-between gap-2'>
            <label className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: f.labelId })}
            </label>
            <input
              type='number'
              value={form[f.key].value}
              placeholder={String(workspaceDefaults[f.key])}
              onChange={e => update(f.key, e.target.value)}
              disabled={saving}
              className='w-20 h-7 rounded-sm border border-border bg-transparent px-2 text-xs text-right text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50'
            />
          </div>
        ))}
      </div>
      <div className='flex justify-between pt-2'>
        <button
          type='button'
          onClick={resetAll}
          disabled={saving}
          className='text-xs text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage({
            id: 'summary.riskThresholds.resetToWorkspace',
          })}
        </button>
        <button
          type='button'
          onClick={handleSave}
          disabled={saving}
          className='text-xs bg-foreground text-background rounded-sm px-2 py-1 disabled:opacity-50'
        >
          {saving
            ? intl.formatMessage({ id: 'common.saving' })
            : intl.formatMessage({ id: 'common.save' })}
        </button>
      </div>
    </div>
  )
}
