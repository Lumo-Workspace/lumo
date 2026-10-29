/**
 * LUM-1076 — since the 2026-10-12 cut-over, sign-in is Lumo's own
 * authentication service (Better Auth). The legal docs and the /security copy
 * must not describe Clerk as the current sign-in provider. Its purpose, and
 * Resend's (one-time sign-in codes), were corrected by the 2026-10-12 change
 * records; the Clerk instance was deleted on 2026-10-28, so Clerk left the
 * list with a `removed` record (RFC LUM-1069 §8).
 */
import fs from 'fs'
import path from 'path'
import { SUBPROCESSOR_CHANGES } from '@/lib/legal/subprocessor-changes'
import { INFRASTRUCTURE_SUBPROCESSORS } from '@/lib/legal/subprocessors'

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
    expect(clerkLines[0]).toMatch(/held was deleted on 2026-10-28/)
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

  it('Clerk is no longer a listed subprocessor, removed with a record on the deletion day', () => {
    expect(INFRASTRUCTURE_SUBPROCESSORS.some(s => s.id === 'clerk')).toBe(false)
    const removal = SUBPROCESSOR_CHANGES.find(
      c => c.id === '2026-10-28-clerk-removed'
    )
    expect(removal).toMatchObject({
      kind: 'removed',
      effectiveAt: '2026-10-28',
      before: { list: 'infrastructure', entry: { id: 'clerk' } },
    })
    expect(removal!.after).toBeUndefined()
    const doc = read('docs/live-docs/legal-subprocessors.md')
    expect(doc).not.toMatch(/^\| Clerk Inc\./m)
    expect(doc).toMatch(
      /^\| 2026-10-28-clerk-removed \| 2026-10-28 \| 2026-10-28 \|/m
    )
  })

  it('records the 2026-10-12 purpose corrections for Resend and Clerk as urgent changes', () => {
    for (const id of [
      '2026-10-12-resend-purpose',
      '2026-10-12-clerk-purpose',
    ]) {
      const change = SUBPROCESSOR_CHANGES.find(c => c.id === id)
      expect(change).toBeDefined()
      expect(change!.kind).toBe('changed')
      expect(change!.effectiveAt).toBe('2026-10-12')
      expect(change!.urgent).toBeDefined()
      expect(change!.before).toEqual(change!.after)
    }
  })

  it.each(LOCALES)(
    '%s: Resend purpose lists sign-in codes; the Clerk purpose key is gone',
    locale => {
      const messages = JSON.parse(read(`lib/i18n/${locale}.json`)) as Record<
        string,
        string
      >
      const en = JSON.parse(read('lib/i18n/en.json')) as Record<string, string>
      const resend = messages['security.subprocessors.purpose.resend']!
      expect(messages['security.subprocessors.purpose.clerk']).toBeUndefined()
      expect(resend).not.toMatch(/\[TODO/)
      if (locale.startsWith('en')) {
        expect(resend).toMatch(/one-time sign-in codes/)
      } else {
        expect(resend).not.toBe(en['security.subprocessors.purpose.resend'])
      }
    }
  )
})
