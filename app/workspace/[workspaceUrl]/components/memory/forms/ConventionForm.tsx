'use client'

import { useIntl } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  type ConventionValue,
  conventionDefault,
  conventionIsValid,
  conventionToContent,
  conventionFromContent,
} from './convention.helpers'

export type { ConventionValue }
export { conventionDefault, conventionIsValid, conventionToContent, conventionFromContent }

export function ConventionForm({ value, onChange }: { value: ConventionValue; onChange: (v: ConventionValue) => void }) {
  const intl = useIntl()
  return (
    <div className='space-y-3'>
      <div className='space-y-1'>
        <Label htmlFor='conv-rule'>{intl.formatMessage({ id: 'memory.form.convention.rule.label' })} *</Label>
        <Textarea id='conv-rule' value={value.rule} onChange={e => onChange({ ...value, rule: e.target.value })} />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='conv-scope'>{intl.formatMessage({ id: 'memory.form.convention.scope.label' })} *</Label>
        <Input id='conv-scope' value={value.scope} onChange={e => onChange({ ...value, scope: e.target.value })} />
      </div>
    </div>
  )
}
