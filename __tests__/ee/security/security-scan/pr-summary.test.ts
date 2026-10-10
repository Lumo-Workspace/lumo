/** @jest-environment node */
import { stripHtmlComments } from '@/ee/security/security-scan/pr-summary'

describe('LUM-988 stripHtmlComments', () => {
  it('removes every HTML comment, including Lumo markers and an unterminated one', () => {
    expect(stripHtmlComments('a <!-- lumo-security:fp:x --> b')).toBe('a   b')
    expect(
      stripHtmlComments('x\n<!-- lumo-security:verifier-rejected -->\ny')
    ).toBe('x\n \ny')
    expect(stripHtmlComments('keep <!-- open to the end')).toBe('keep  ')
  })

  it('leaves text without comments unchanged', () => {
    expect(stripHtmlComments('if (a < b && c --> d) {}')).toBe(
      'if (a < b && c --> d) {}'
    )
  })
})
