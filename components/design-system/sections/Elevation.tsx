import { ELEVATIONS, RADII } from '../data/tokens'
import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

export function Elevation() {
  return (
    <Section id='elevation' title='Elevation & radius'>
      <h3 className='mb-3 text-body-strong text-foreground'>Shadow</h3>
      <VariantGrid>
        {ELEVATIONS.map(name => (
          <VariantCell key={name} label={`shadow-${name}`}>
            <div className={`size-20 rounded-lg bg-card shadow-${name}`} />
          </VariantCell>
        ))}
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>Radius</h3>
      <VariantGrid>
        {RADII.map(tier => (
          <VariantCell key={tier} label={`rounded-${tier}`}>
            <div className={`size-20 border border-border bg-muted rounded-${tier}`} />
          </VariantCell>
        ))}
      </VariantGrid>
    </Section>
  )
}
