import { CONTROL_SIZES } from '../data/tokens'
import { Section } from '../primitives/Section'

export function Spacing() {
  return (
    <Section id='spacing' title='Spacing & control sizes'>
      <h3 className='mb-3 text-body-strong text-foreground'>
        Control heights (h-control-*)
      </h3>
      <div className='mb-8 flex flex-col gap-3'>
        {CONTROL_SIZES.map(size => (
          <div key={size} className='flex items-center gap-4'>
            <code className='w-28 shrink-0 text-caption text-muted-foreground'>
              h-control-{size}
            </code>
            <div className={`w-40 rounded-md bg-primary h-control-${size}`} />
          </div>
        ))}
      </div>
      <h3 className='mb-3 text-body-strong text-foreground'>
        Inset padding (px-control-inset-*)
      </h3>
      <div className='flex flex-col gap-3'>
        {CONTROL_SIZES.map(size => (
          <div key={size} className='flex items-center gap-4'>
            <code className='w-36 shrink-0 text-caption text-muted-foreground'>
              px-control-inset-{size}
            </code>
            <div className='inline-flex'>
              <span className={`rounded-md bg-muted py-2 px-control-inset-${size}`}>
                inset
              </span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
