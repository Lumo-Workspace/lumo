import { ANIMATIONS, EASINGS } from '../data/tokens'
import { Section } from '../primitives/Section'

export function Motion() {
  return (
    <Section id='motion' title='Motion'>
      <h3 className='mb-3 text-body-strong text-foreground'>Easing tokens</h3>
      <ul className='mb-8 flex flex-col gap-1'>
        {EASINGS.map(name => (
          <li key={name} className='text-body text-foreground'>
            <code className='text-caption text-muted-foreground'>--ease-{name}</code>
          </li>
        ))}
      </ul>
      <h3 className='mb-3 text-body-strong text-foreground'>Animations</h3>
      <div className='flex flex-wrap gap-8'>
        {ANIMATIONS.map(name => (
          <div key={name} className='flex flex-col items-center gap-2'>
            <div className={`size-16 rounded-md bg-primary animate-${name}`} />
            <code className='text-caption text-muted-foreground'>animate-{name}</code>
          </div>
        ))}
      </div>
    </Section>
  )
}
