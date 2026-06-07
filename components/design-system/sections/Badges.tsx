import { Badge } from '@/components/ui/badge'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

const VARIANTS = ['default', 'secondary', 'destructive', 'outline'] as const

export function Badges() {
  return (
    <Section id='badges' title='Badge'>
      <VariantGrid>
        {VARIANTS.map(variant => (
          <VariantCell key={variant} label={variant}>
            <Badge variant={variant}>Badge</Badge>
          </VariantCell>
        ))}
      </VariantGrid>
    </Section>
  )
}
