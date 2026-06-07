import { TYPE_TIERS } from '../data/tokens'
import { Section } from '../primitives/Section'

export function TypographyScale() {
  return (
    <Section id='typography' title='Typography'>
      <div className='flex flex-col gap-5'>
        {TYPE_TIERS.map(tier => (
          <div key={tier} className='flex items-baseline gap-4'>
            <code className='w-28 shrink-0 text-caption text-muted-foreground'>
              text-{tier}
            </code>
            <span className={`text-${tier} text-foreground`}>
              The quick brown fox jumps over the lazy dog
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}
