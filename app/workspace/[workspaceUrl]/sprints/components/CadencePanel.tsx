'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { sprintsClient } from '@/lib/api-client'
import { useIntl } from 'react-intl'
import {
  SPRINT_DURATION_DAYS,
  SPRINT_COOLDOWN_DAYS,
} from '@/lib/validation/sprint.schema'

interface Team {
  id: string
  name: string
  sprintsEnabled: boolean
  sprintDurationDays: number
  sprintCooldownDays: number
  sprintStartWeekday: number
  sprintAutoCreate: number
  sprintAutoAddCompleted: boolean
}

const WEEKDAY_LABEL_IDS = [
  'sprints.settings.weekday.sun',
  'sprints.settings.weekday.mon',
  'sprints.settings.weekday.tue',
  'sprints.settings.weekday.wed',
  'sprints.settings.weekday.thu',
  'sprints.settings.weekday.fri',
  'sprints.settings.weekday.sat',
] as const

export function CadencePanel({ team }: { team: Team }) {
  const intl = useIntl()
  const [enabled, setEnabled] = useState(team.sprintsEnabled)
  const [durationDays, setDurationDays] = useState(team.sprintDurationDays)
  const [cooldownDays, setCooldownDays] = useState(team.sprintCooldownDays)
  const [startWeekday, setStartWeekday] = useState(team.sprintStartWeekday)
  const [autoCreate, setAutoCreate] = useState(team.sprintAutoCreate)
  const [autoAddCompleted, setAutoAddCompleted] = useState(
    team.sprintAutoAddCompleted
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await sprintsClient.setCadence(team.id, {
        enabled,
        durationDays,
        cooldownDays,
        startWeekday,
        autoCreate,
        autoAddCompleted,
      })
      toast.success(intl.formatMessage({ id: 'sprints.settings.saved' }))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const disabled = !enabled

  return (
    <section className='flex flex-col gap-4 rounded-sm border p-4'>
      <header className='flex items-center justify-between'>
        <h3 className='text-title'>{team.name}</h3>
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

      <p className='text-caption text-muted-foreground'>
        {intl.formatMessage({ id: 'sprints.settings.enableHint' })}
      </p>

      <div className='flex flex-col gap-3'>
        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor={`duration-${team.id}`}>
            {intl.formatMessage({ id: 'sprints.settings.duration' })}
          </Label>
          <Select
            value={String(durationDays)}
            onValueChange={v => setDurationDays(Number(v))}
            disabled={disabled}
          >
            <SelectTrigger id={`duration-${team.id}`} className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPRINT_DURATION_DAYS.map(d => (
                <SelectItem key={d} value={String(d)}>
                  {intl.formatMessage(
                    { id: 'sprints.settings.weeks' },
                    { n: d / 7 }
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor={`cooldown-${team.id}`}>
            {intl.formatMessage({ id: 'sprints.settings.cooldown' })}
          </Label>
          <Select
            value={String(cooldownDays)}
            onValueChange={v => setCooldownDays(Number(v))}
            disabled={disabled}
          >
            <SelectTrigger id={`cooldown-${team.id}`} className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPRINT_COOLDOWN_DAYS.map(d => (
                <SelectItem key={d} value={String(d)}>
                  {d === 0
                    ? intl.formatMessage({
                        id: 'sprints.settings.cooldown.none',
                      })
                    : intl.formatMessage({
                        id: 'sprints.settings.cooldown.oneWeek',
                      })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor={`weekday-${team.id}`}>
            {intl.formatMessage({ id: 'sprints.settings.startWeekday' })}
          </Label>
          <Select
            value={String(startWeekday)}
            onValueChange={v => setStartWeekday(Number(v))}
            disabled={disabled}
          >
            <SelectTrigger id={`weekday-${team.id}`} className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_LABEL_IDS.map((labelId, i) => (
                <SelectItem key={i} value={String(i)}>
                  {intl.formatMessage({ id: labelId })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor={`autocreate-${team.id}`}>
            {intl.formatMessage({ id: 'sprints.settings.autoCreate' })}
          </Label>
          <Select
            value={String(autoCreate)}
            onValueChange={v => setAutoCreate(Number(v))}
            disabled={disabled}
          >
            <SelectTrigger id={`autocreate-${team.id}`} className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4].map(n => (
                <SelectItem key={n} value={String(n)}>
                  {n === 0
                    ? intl.formatMessage({
                        id: 'sprints.settings.autoCreate.off',
                      })
                    : intl.formatMessage(
                        { id: 'sprints.settings.autoCreate.count' },
                        { n }
                      )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex flex-col gap-1'>
          <div className='flex items-center justify-between gap-4'>
            <Label htmlFor={`autoadd-${team.id}`}>
              {intl.formatMessage({ id: 'sprints.settings.autoAddCompleted' })}
            </Label>
            <Switch
              checked={autoAddCompleted}
              onCheckedChange={setAutoAddCompleted}
              id={`autoadd-${team.id}`}
              disabled={disabled}
            />
          </div>
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({
              id: 'sprints.settings.autoAddCompleted.hint',
            })}
          </p>
        </div>
      </div>

      <div>
        <Button onClick={save} disabled={saving}>
          {intl.formatMessage({ id: 'sprints.settings.save' })}
        </Button>
      </div>
    </section>
  )
}
