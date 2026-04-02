import { Star } from 'lucide-react'

import { cn } from '@/lib/utils'

import { PricingColumn, PricingColumnProps } from '../../ui/pricing-column'
import { Section } from '../../ui/section'

interface PricingProps {
  title?: string | false
  description?: string | false
  plans?: PricingColumnProps[] | false
  className?: string
}

export default function Pricing({
  title = 'Simple, transparent pricing.',
  description = "Start free. Scale when you're ready.",
  plans = [
    {
      name: 'Free',
      description: 'For individuals getting started',
      price: 0,
      priceNote: 'No credit card required. 1 seat included.',
      cta: {
        variant: 'glow',
        label: 'Join Waitlist',
        href: '/signup',
      },
      features: [
        '5 agent tasks / month',
        'GitHub integration',
        'Community support',
      ],
      variant: 'default',
    },
    {
      name: 'Pro',
      icon: <Star className='size-4 fill-current' />,
      description: 'For small teams shipping fast',
      price: 29,
      priceNote: 'Per seat / month. Everything in Free, plus:',
      cta: {
        variant: 'default',
        label: 'Join Waitlist',
        href: '/signup',
      },
      features: [
        '50 agent tasks / month',
        'Figma, Notion, Google Docs context',
        'Slack notifications',
        'Priority support',
      ],
      variant: 'glow-brand',
    },
    {
      name: 'Team',
      description: 'For growing teams that need more',
      price: 79,
      priceNote: 'Per seat / month. Everything in Pro, plus:',
      cta: {
        variant: 'default',
        label: 'Join Waitlist',
        href: '/signup',
      },
      features: [
        '200 agent tasks / month',
        'Custom memory & conventions',
        'Advanced agent controls',
        'Dedicated support',
      ],
      variant: 'glow',
    },
  ],
  className = '',
}: PricingProps) {
  return (
    <Section id='pricing' className={cn(className)}>
      <div className='mx-auto flex max-w-6xl flex-col items-center gap-12'>
        {(title || description) && (
          <div className='flex flex-col items-center gap-4 px-4 text-center sm:gap-8'>
            {title && (
              <h2 className='text-3xl leading-tight font-semibold sm:text-5xl sm:leading-tight'>
                {title}
              </h2>
            )}
            {description && (
              <p className='text-md text-muted-foreground max-w-[600px] font-medium sm:text-xl'>
                {description}
              </p>
            )}
          </div>
        )}
        {plans !== false && plans.length > 0 && (
          <div className='max-w-container mx-auto grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3'>
            {plans.map(plan => (
              <PricingColumn key={plan.name} {...plan} />
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}
