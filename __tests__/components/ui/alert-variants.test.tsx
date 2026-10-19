import { render, screen } from '@testing-library/react'
import { AlertTriangle } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  alertVariants,
} from '@/components/ui/alert'

// LUM-1268: tone variants carry colour in the -subtle fill, -border outline
// and -text icon only; callout text stays text-foreground.
describe('alertVariants', () => {
  it('keeps the default variant neutral', () => {
    const cls = alertVariants()
    expect(cls).toContain('bg-background')
    expect(cls).toContain('text-foreground')
    expect(cls).toContain('px-4 py-3 text-body')
  })

  it.each(['info', 'success', 'warning', 'danger'] as const)(
    '%s uses the -subtle / -border / -text tokens with foreground text',
    tone => {
      const cls = alertVariants({ variant: tone })
      expect(cls).toContain(`bg-${tone}-subtle`)
      expect(cls).toContain(`border-${tone}-border`)
      expect(cls).toContain(`[&>svg]:text-${tone}-text`)
      expect(cls).toContain('text-foreground')
      expect(cls).not.toMatch(new RegExp(`(^| )text-${tone}-text`))
    }
  )

  it('size sm is the compact caption form', () => {
    const cls = alertVariants({ size: 'sm' })
    expect(cls).toContain('px-3 py-2 text-caption')
    expect(cls).not.toContain('text-body')
  })
})

describe('Alert', () => {
  it('renders role=alert by default and lets callers override it', () => {
    const { rerender } = render(<Alert>hi</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('hi')
    rerender(<Alert role='note'>hi</Alert>)
    expect(screen.getByRole('note')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('merges the variant icon colour over the base one', () => {
    render(
      <Alert variant='warning' size='sm' data-testid='a'>
        <AlertTriangle />
        <AlertTitle>Title</AlertTitle>
        <AlertDescription>Body</AlertDescription>
      </Alert>
    )
    const el = screen.getByTestId('a')
    expect(el.className).toContain('[&>svg]:text-warning-text')
    expect(el.className).not.toContain('[&>svg]:text-foreground')
    expect(el.className).toContain('text-caption')
    expect(el.className).not.toContain('text-body')
    expect(screen.getByText('Title')).toHaveClass('text-body-strong')
  })
})
