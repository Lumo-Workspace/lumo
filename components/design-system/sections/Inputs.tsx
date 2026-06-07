import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

export function Inputs() {
  return (
    <Section id='inputs' title='Form fields'>
      <VariantGrid>
        <VariantCell label='default'>
          <Input placeholder='Placeholder' className='w-56' />
        </VariantCell>
        <VariantCell label='disabled'>
          <Input placeholder='Placeholder' disabled className='w-56' />
        </VariantCell>
        <VariantCell label='aria-invalid'>
          <Input placeholder='Placeholder' aria-invalid className='w-56' />
        </VariantCell>
        <VariantCell label='with label'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='ds-input'>Label</Label>
            <Input id='ds-input' placeholder='Placeholder' className='w-56' />
          </div>
        </VariantCell>
        <VariantCell label='textarea'>
          <Textarea placeholder='Placeholder' className='w-56' />
        </VariantCell>
      </VariantGrid>
    </Section>
  )
}
