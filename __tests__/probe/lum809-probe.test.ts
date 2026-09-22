/** @jest-environment node */
import { exec } from 'node:child_process'
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

/**
 * LUM-809 probe, reverse direction. Never invoked, and the command is a
 * literal, so there is nothing tainted here to find — the point is only that
 * a bare call to the imported name is still RECOGNISED as a child process
 * after the rule was narrowed. If this half does not light the layer, the
 * narrowing went too far and real sinks stopped being seen.
 */
export function neverRun(): void {
  exec('true', () => {})
}
