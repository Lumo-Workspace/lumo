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

  it('escapes the entrant name and the sign-in URL', () => {
    const { html } = buildWaitlistApprovedEmail({
      name: '<img src=x onerror=1>',
      signInUrl: 'https://app.example.com/signin?a="><script>',
    })
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('"><script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })
})
