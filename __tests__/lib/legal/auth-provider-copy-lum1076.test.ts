/**
 * LUM-1076 — since the 2026-10-12 cut-over, sign-in is Lumo's own
 * authentication service (Better Auth); Clerk only keeps its data through the
 * rollback period. The legal docs and the /security copy must not describe
 * Clerk as the current sign-in provider. Clerk stays a listed subprocessor
 * until its instance is deleted (RFC LUM-1069 §8), so the subprocessor doc and
 * the `security.subprocessors.purpose.clerk` key are out of scope here.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..', '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const I18N_DIR = path.join(ROOT, 'lib', 'i18n')
const LOCALES = fs
  .readdirSync(I18N_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))

describe('LUM-1076: auth provider copy', () => {
  it('covers all 16 locales', () => {
    expect(LOCALES).toHaveLength(16)
  })

  it.each(LOCALES)(
    '%s: security.auth.signin no longer names Clerk and is translated',
    locale => {
      const messages = JSON.parse(read(`lib/i18n/${locale}.json`)) as Record<
        string,
        string
      >
      const signin = messages['security.auth.signin']
      expect(signin).toBeDefined()
      expect(signin).not.toMatch(/Clerk/)
      expect(signin).not.toMatch(/\[TODO/)
      expect(signin).toMatch(/Lumo/)
      expect(signin).toMatch(/Google/)
      if (!locale.startsWith('en')) {
        const english = JSON.parse(read('lib/i18n/en.json'))[
          'security.auth.signin'
        ]
        expect(signin).not.toBe(english)
      }
    }
  )

  it('the privacy policy names Lumo as the sign-in service, Clerk only as the previous one', () => {
    const doc = read('docs/live-docs/legal-privacy-policy.md')
    expect(doc).not.toMatch(/handled by Clerk/)
    expect(doc).not.toMatch(/by your sign-in provider/)
    expect(doc).toMatch(
      /Sign-in is handled by Lumo's own authentication service/
    )
    const clerkLines = doc.split('\n').filter(l => l.includes('Clerk'))
    expect(clerkLines).toHaveLength(1)
    expect(clerkLines[0]).toMatch(
      /previous sign-in provider, Clerk, no longer handles sign-in/
    )
  })

  it('the DPA describes authentication through Lumo, not Clerk', () => {
    const doc = read('docs/live-docs/legal-dpa-template.md')
    expect(doc).not.toMatch(/Clerk/)
    expect(doc).not.toMatch(/in the identity provider/)
    expect(doc).toMatch(
      /User authentication through Lumo's own authentication service/
    )
  })

  it('the self-hosting guide no longer says the hosted service uses Clerk', () => {
    const doc = read('docs/self-hosting/README.md')
    expect(doc).not.toMatch(/Clerk is what the hosted service uses/)
  })
})
