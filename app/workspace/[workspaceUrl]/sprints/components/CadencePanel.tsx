'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { sprintsClient } from '@/lib/api-client'
import { useIntl } from 'react-intl'

interface Team {
  id: string
  name: string
  sprintsEnabled: boolean
}

export function CadencePanel({ team }: { team: Team }) {
  const intl = useIntl()
  const [enabled, setEnabled] = useState(team.sprintsEnabled)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await sprintsClient.setCadence(team.id, { enabled })
      toast.success(intl.formatMessage({ id: 'sprints.settings.saved' }))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
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

      <p className='text-xs text-muted-foreground'>
        {intl.formatMessage({ id: 'sprints.settings.enableHint' })}
      </p>

      <div>
        <Button onClick={save} disabled={saving}>
          {intl.formatMessage({ id: 'sprints.settings.save' })}
        </Button>
      </div>
    </section>
  )
}
