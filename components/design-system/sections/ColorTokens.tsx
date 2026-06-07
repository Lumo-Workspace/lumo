import { COLOR_GROUPS } from '../data/tokens'
import { Section } from '../primitives/Section'
import { Swatch } from '../primitives/Swatch'

export function ColorTokens() {
  return (
    <Section id='colors' title='Color tokens'>
      <div className='flex flex-col gap-8'>
        {COLOR_GROUPS.map(group => (
          <div key={group.id} id={group.id} className='scroll-mt-20'>
            <h3 className='mb-3 text-body-strong text-foreground'>{group.title}</h3>
            <div className='flex flex-wrap gap-4'>
              {group.tokens.map(name => (
                <Swatch key={name} name={name} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
