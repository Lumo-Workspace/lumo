'use client'

import { useIntl } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  type TrapValue,
  trapDefault,
  trapIsValid,
  trapToContent,
  trapFromContent,
} from './trap.helpers'

export type { TrapValue }
export { trapDefault, trapIsValid, trapToContent, trapFromContent }

export function TrapForm({
  value,
  onChange,
}: {
  value: TrapValue
  onChange: (v: TrapValue) => void
}) {
  const intl = useIntl()
  return (
    <div className='space-y-3'>
      <div className='space-y-1'>
        <Label htmlFor='trap-summary'>
          {intl.formatMessage({ id: 'memory.form.trap.summary.label' })}
        </Label>
        <Input
          id='trap-summary'
          value={value.summary}
          onChange={e => onChange({ ...value, summary: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='trap-trigger'>
          {intl.formatMessage({ id: 'memory.form.trap.trigger.label' })} *
        </Label>
        <Input
          id='trap-trigger'
          value={value.trigger}
          onChange={e => onChange({ ...value, trigger: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='trap-outcome'>
          {intl.formatMessage({ id: 'memory.form.trap.outcome.label' })} *
        </Label>
        <Textarea
          id='trap-outcome'
          value={value.outcome}
          onChange={e => onChange({ ...value, outcome: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='trap-workaround'>
          {intl.formatMessage({ id: 'memory.form.trap.workaround.label' })}
        </Label>
        <Textarea
          id='trap-workaround'
          value={value.workaround}
          onChange={e => onChange({ ...value, workaround: e.target.value })}
        />
      </div>
    </div>
  )
}
