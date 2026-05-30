'use client'

import { useIntl } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  type DecisionValue,
  decisionDefault,
  decisionIsValid,
  decisionToContent,
  decisionFromContent,
} from './decision.helpers'

export type { DecisionValue }
export {
  decisionDefault,
  decisionIsValid,
  decisionToContent,
  decisionFromContent,
}

export function DecisionForm({
  value,
  onChange,
}: {
  value: DecisionValue
  onChange: (v: DecisionValue) => void
}) {
  const intl = useIntl()
  return (
    <div className='space-y-3'>
      <div className='space-y-1'>
        <Label htmlFor='dec-summary'>
          {intl.formatMessage({ id: 'memory.form.decision.summary.label' })}
        </Label>
        <Input
          id='dec-summary'
          value={value.summary}
          onChange={e => onChange({ ...value, summary: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='dec-what'>
          {intl.formatMessage({ id: 'memory.form.decision.what.label' })} *
        </Label>
        <Input
          id='dec-what'
          value={value.what}
          onChange={e => onChange({ ...value, what: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='dec-why'>
          {intl.formatMessage({ id: 'memory.form.decision.why.label' })} *
        </Label>
        <Textarea
          id='dec-why'
          value={value.why}
          onChange={e => onChange({ ...value, why: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='dec-alt'>
          {intl.formatMessage({
            id: 'memory.form.decision.alternatives.label',
          })}
        </Label>
        <Textarea
          id='dec-alt'
          value={value.alternatives}
          onChange={e => onChange({ ...value, alternatives: e.target.value })}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='dec-impl'>
          {intl.formatMessage({
            id: 'memory.form.decision.implications.label',
          })}
        </Label>
        <Textarea
          id='dec-impl'
          value={value.implications}
          onChange={e => onChange({ ...value, implications: e.target.value })}
        />
      </div>
    </div>
  )
}
