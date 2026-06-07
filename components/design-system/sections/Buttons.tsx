import { Button } from '@/components/ui/button'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

const VARIANTS = [
  'default',
  'destructive',
  'outline',
  'secondary',
  'ghost',
  'link',
] as const
const SIZES = ['default', 'sm', 'lg'] as const

export function Buttons() {
  return (
    <Section id='buttons' title='Button'>
      <h3 className='mb-3 text-body-strong text-foreground'>Variants</h3>
      <VariantGrid>
        {VARIANTS.map(variant => (
          <VariantCell key={variant} label={variant}>
            <Button variant={variant}>Button</Button>
          </VariantCell>
        ))}
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>Sizes</h3>
      <VariantGrid>
        {SIZES.map(size => (
          <VariantCell key={size} label={size}>
            <Button size={size}>Button</Button>
          </VariantCell>
        ))}
        <VariantCell label='icon'>
          <Button size='icon' aria-label='icon button'>
            +
          </Button>
        </VariantCell>
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>Disabled</h3>
      <VariantGrid>
        <VariantCell label='disabled'>
          <Button disabled>Button</Button>
        </VariantCell>
      </VariantGrid>
    </Section>
  )
}
