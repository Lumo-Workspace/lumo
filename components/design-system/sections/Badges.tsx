import { Badge } from '@/components/ui/badge'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

const VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'outline-muted',
  'muted',
  'info',
  'success',
  'warning',
  'danger',
] as const

const SIZES = ['default', 'sm', 'xs'] as const

export function Badges() {
  return (
    <Section id='badges' title='Badge'>
      <div className='flex flex-col gap-8'>
        <VariantGrid>
          {VARIANTS.map(variant => (
            <VariantCell key={variant} label={variant}>
              <Badge variant={variant}>Badge</Badge>
            </VariantCell>
          ))}
        </VariantGrid>
        <VariantGrid>
          {SIZES.map(size => (
            <VariantCell key={size} label={`size=${size}`}>
              <Badge variant='muted' size={size}>
                12
              </Badge>
            </VariantCell>
          ))}
          <VariantCell label='shape=square'>
            <Badge variant='outline-muted' size='xs' shape='square'>
              PREVIEW
            </Badge>
          </VariantCell>
          <VariantCell label='plain + data colour'>
            <Badge
              variant='plain'
              size='xs'
              shape='square'
              className='bg-info-subtle text-info-text'
            >
              frontend
            </Badge>
          </VariantCell>
        </VariantGrid>
      </div>
    </Section>
  )
}
