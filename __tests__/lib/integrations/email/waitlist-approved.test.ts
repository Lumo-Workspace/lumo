import { buildWaitlistApprovedEmail } from '@/lib/integrations/email'

describe('buildWaitlistApprovedEmail', () => {
  it('links to /signin and never /signup', () => {
    const { subject, html } = buildWaitlistApprovedEmail({
      name: 'Ada',
      signInUrl: 'https://app.example.com/signin',
    })
    expect(subject).toBe("You're in — create your Lumo workspace")
    expect(html).toContain('href="https://app.example.com/signin"')
    expect(html).not.toContain('/signup')
    expect(html).toContain('Ada')
  })

  it('works without a name', () => {
    const { html } = buildWaitlistApprovedEmail({
      name: null,
      signInUrl: 'https://app.example.com/signin',
    })
    expect(html).toContain('Hi,')
  })
})
