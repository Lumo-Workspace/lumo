/** @jest-environment node */
/**
 * LUM-809 probe — throwaway. This branch exists only so `lumo pr scan` can be
 * read against the rule now deployed in production; it is never merged.
 *
 * The file is deliberately bare: one regex match and nothing else. Any second
 * sink in the diff (a child process, a raw query, eval, a write, a fetch)
 * would light the hunt on its own and make the read-out say nothing about the
 * one thing being probed.
 */
const PROBE = /^probe-(\d+)$/

describe('LUM-809 probe', () => {
  it('matches a probe token', () => {
    const m = PROBE.exec('probe-42')
    expect(m?.[1]).toBe('42')
  })
})
