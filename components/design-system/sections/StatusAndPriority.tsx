import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

const STATUS_TOKENS = [
  'status-todo',
  'status-in-progress',
  'status-in-review',
  'status-done',
] as const

const PRIORITY_TOKENS = [
  'priority-low',
  'priority-medium',
  'priority-high',
  'priority-urgent',
] as const

export function StatusAndPriority() {
  return (
    <Section id='status-priority' title='Status & priority'>
      <h3 className='mb-3 text-body-strong text-foreground'>
        Status colors
      </h3>
      <VariantGrid>
        {STATUS_TOKENS.map(token => (
          <VariantCell key={token} label={token}>
            <span className='flex items-center gap-2 text-body text-foreground'>
              <span
                className='inline-block size-3 rounded-full'
                style={{ backgroundColor: `var(--${token})` }}
              />
              {token.replace('status-', '')}
            </span>
          </VariantCell>
        ))}
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>
        Priority colors
      </h3>
      <VariantGrid>
        {PRIORITY_TOKENS.map(token => (
          <VariantCell key={token} label={token}>
            <span className='flex items-center gap-2 text-body text-foreground'>
              <span
                className='inline-block size-3 rounded-full'
                style={{ backgroundColor: `var(--${token})` }}
              />
              {token.replace('priority-', '')}
            </span>
          </VariantCell>
        ))}
      </VariantGrid>
    </Section>
  )
}
