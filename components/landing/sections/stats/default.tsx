import { Section } from '../../ui/section'

interface StatItemProps {
  label?: string
  value: string | number
  suffix?: string
  description?: string
}

interface StatsProps {
  items?: StatItemProps[] | false
  className?: string
}

export default function Stats({
  items = [
    {
      label: 'joining',
      value: '240',
      suffix: '+',
      description: 'early-access teams worldwide',
    },
    {
      label: 'under',
      value: '5',
      suffix: 's',
      description: 'from assigned to agent in motion',
    },
    {
      label: 'per task',
      value: 1,
      description: 'fully isolated execution environment',
    },
    {
      label: 'every time',
      value: 1,
      description: 'production-ready PR, nothing less',
    },
  ],
  className,
}: StatsProps) {
  return (
    <Section className={className}>
      <div className='container mx-auto max-w-[960px]'>
        {items !== false && items.length > 0 && (
          <div className='grid grid-cols-2 gap-12 sm:grid-cols-4'>
            {items.map((item, index) => (
              <div
                key={index}
                className='flex flex-col items-start gap-3 text-left'
              >
                {item.label && (
                  <div className='text-muted-foreground text-sm font-semibold'>
                    {item.label}
                  </div>
                )}
                <div className='flex items-baseline gap-2'>
                  <div className='from-foreground to-foreground dark:to-brand bg-linear-to-r bg-clip-text text-4xl font-medium text-transparent drop-shadow-[2px_1px_24px_var(--brand-foreground)] transition-all duration-300 sm:text-5xl md:text-6xl'>
                    {item.value}
                  </div>
                  {item.suffix && (
                    <div className='text-brand text-2xl font-semibold'>
                      {item.suffix}
                    </div>
                  )}
                </div>
                {item.description && (
                  <div className='text-muted-foreground text-sm font-semibold text-pretty'>
                    {item.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}
