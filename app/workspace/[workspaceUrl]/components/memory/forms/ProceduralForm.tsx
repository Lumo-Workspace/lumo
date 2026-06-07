'use client'

import { useIntl } from 'react-intl'
import { Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  type ProceduralValue,
  proceduralDefault,
  proceduralIsValid,
  proceduralToContent,
  proceduralFromContent,
} from './procedural.helpers'

export type { ProceduralValue }
export {
  proceduralDefault,
  proceduralIsValid,
  proceduralToContent,
  proceduralFromContent,
}

export function ProceduralForm({
  value,
  onChange,
}: {
  value: ProceduralValue
  onChange: (v: ProceduralValue) => void
}) {
  const intl = useIntl()
  const setStep = (i: number, s: string) => {
    const steps = [...value.steps]
    steps[i] = s
    onChange({ ...value, steps })
  }
  const addStep = () => onChange({ ...value, steps: [...value.steps, ''] })
  const removeStep = (i: number) =>
    onChange({ ...value, steps: value.steps.filter((_, j) => j !== i) })

  return (
    <div className='space-y-3'>
      <div className='space-y-1'>
        <Label htmlFor='proc-summary'>
          {intl.formatMessage({ id: 'memory.form.procedural.summary.label' })}
        </Label>
        <Input
          id='proc-summary'
          value={value.summary}
          onChange={e => onChange({ ...value, summary: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='proc-workflow'>
          {intl.formatMessage({ id: 'memory.form.procedural.workflow.label' })}{' '}
          *
        </Label>
        <Input
          id='proc-workflow'
          value={value.workflow}
          onChange={e => onChange({ ...value, workflow: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='proc-trigger'>
          {intl.formatMessage({ id: 'memory.form.procedural.trigger.label' })} *
        </Label>
        <Input
          id='proc-trigger'
          value={value.trigger}
          onChange={e => onChange({ ...value, trigger: e.target.value })}
        />
      </div>
      <div className='space-y-2'>
        <Label>
          {intl.formatMessage({ id: 'memory.form.procedural.steps.label' })}
        </Label>
        {value.steps.map((step, i) => (
          <div key={i} className='flex items-center gap-2'>
            <Input
              value={step}
              onChange={e => setStep(i, e.target.value)}
              aria-label={`step-${i}`}
            />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='shrink-0 text-muted-foreground hover:text-red-500'
              onClick={() => removeStep(i)}
              aria-label={`remove-step-${i}`}
            >
              <X className='size-4' />
            </Button>
          </div>
        ))}
        <Button type='button' variant='ghost' size='sm' onClick={addStep}>
          <Plus className='size-3.5 mr-1' />
          {intl.formatMessage({ id: 'memory.form.procedural.steps.add' })}
        </Button>
      </div>
    </div>
  )
}
