/**
 * @jest-environment node
 *
 * LUM-784 — the tier-2 CLI commands print the server's redaction count as a
 * one-line notice; absent (older server) or zero prints nothing, so clean
 * output is byte-identical to before.
 */
import { printRedactionNotice } from '@/cli/src/lib/redaction-notice'

describe('printRedactionNotice', () => {
  let log: jest.SpyInstance
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => log.mockRestore())

  it('is silent for undefined, 0 and negative counts', () => {
    printRedactionNotice(undefined)
    printRedactionNotice(0)
    printRedactionNotice(-1)
    expect(log).not.toHaveBeenCalled()
  })

  it('prints one line naming the count, singular and plural', () => {
    printRedactionNotice(1)
    printRedactionNotice(3)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0]![0]).toMatch(
      /^⚠ 1 suspected credential was redacted before injection/
    )
    expect(log.mock.calls[1]![0]).toMatch(
      /^⚠ 3 suspected credentials were redacted before injection/
    )
  })
})
