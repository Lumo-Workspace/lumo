/**
 * @jest-environment node
 *
 * `extractErrorMessage` — shared API error-body unwrapping (LUM-410 cleanup;
 * previously copy-pasted try/catch blocks across doc commands).
 */
import { extractErrorMessage } from '../../src/lib/api'

describe('extractErrorMessage', () => {
  it('returns the error field of a JSON body', () => {
    expect(extractErrorMessage('{"error":"Revision conflict"}')).toBe(
      'Revision conflict'
    )
  })

  it('falls back to the raw text for non-JSON bodies', () => {
    expect(extractErrorMessage('Internal Server Error')).toBe(
      'Internal Server Error'
    )
  })

  it('falls back to the raw text when JSON has no error string', () => {
    expect(extractErrorMessage('{"message":"nope"}')).toBe('{"message":"nope"}')
  })
})
