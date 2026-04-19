'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { sprintsClient } from '@/lib/api-client'
import { useIntl } from 'react-intl'

const PRESETS = [7, 14, 28]

interface Team {
  id: string
  name: string
  sprintCadenceDays: number | null
  sprintAutoPrepare: boolean
}

export function CadencePanel({
  team,
  onSaved,
}: {
  team: Team
  onSaved?: () => void
}) {
  const intl = useIntl()
  const [enabled, setEnabled] = useState(team.sprintCadenceDays != null)
  const [mode, setMode] = useState<number | 'custom'>(
    team.sprintCadenceDays && PRESETS.includes(team.sprintCadenceDays)
      ? team.sprintCadenceDays
      : team.sprintCadenceDays != null
        ? 'custom'
        : 14
  )
  const [custom, setCustom] = useState<number>(team.sprintCadenceDays ?? 14)
  const [autoPrepare, setAutoPrepare] = useState(team.sprintAutoPrepare ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const cadenceDays = !enabled ? null : mode === 'custom' ? custom : mode
      await sprintsClient.setCadence(team.id, { cadenceDays, autoPrepare })
      onSaved?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className='flex flex-col gap-4 rounded border p-4'>
      <header className='flex items-center justify-between'>
        <h3 className='font-semibold'>{team.name}</h3>
      </header>

      <div className='flex items-center gap-2'>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          id={`enable-${team.id}`}
        />
        <Label htmlFor={`enable-${team.id}`}>
          {intl.formatMessage({ id: 'sprints.settings.enable' })}
        </Label>
      </div>

      {enabled && (
        <>
          <fieldset className='flex flex-col gap-2'>
            <legend className='text-sm font-medium'>
              {intl.formatMessage({ id: 'sprints.settings.cadence' })}
            </legend>
            <div className='flex flex-wrap gap-2'>
              {PRESETS.map(p => (
                <Button
                  key={p}
                  type='button'
                  size='sm'
                  variant={mode === p ? 'default' : 'outline'}
                  onClick={() => setMode(p)}
                >
                  {p === 7 ? '1 week' : p === 14 ? '2 weeks' : '4 weeks'}
                </Button>
              ))}
              <Button
                type='button'
                size='sm'
                variant={mode === 'custom' ? 'default' : 'outline'}
                onClick={() => setMode('custom')}
              >
                {intl.formatMessage({ id: 'sprints.settings.custom' })}
              </Button>
              {mode === 'custom' && (
                <Input
                  type='number'
                  min={1}
                  max={90}
                  value={custom}
                  onChange={e => setCustom(Number(e.target.value))}
                  className='w-24'
                />
              )}
            </div>
          </fieldset>

          <div className='flex items-center gap-2'>
            <Switch
              checked={autoPrepare}
              onCheckedChange={setAutoPrepare}
              id={`ap-${team.id}`}
            />
            <Label htmlFor={`ap-${team.id}`}>
              {intl.formatMessage({ id: 'sprints.settings.autoPrepare' })}
            </Label>
          </div>
        </>
      )}

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <div>
        <Button onClick={save} disabled={saving}>
          {intl.formatMessage({ id: 'sprints.settings.save' })}
        </Button>
      </div>
    </section>
  )
}
