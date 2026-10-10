/**
 * @jest-environment node
 *
 * LUM-1036 — the per-event cap on SENSITIVE_PATH_READ bounds how many
 * crossings one event writes, not what the reviewer can see:
 *   (a) paths past the cap are named on the last kept crossing;
 *   (b) project-rule reads are filtered BEFORE the cap, so built-in hits
 *       earlier in the same command cannot crowd them out.
 * Plain string samples only — nothing reads a real file.
 */
import { detectCrossings } from '@/lib/services/boundary-detector.service'
import {
  detectProjectSensitiveReads,
  detectSensitiveReads,
  MAX_SENSITIVE_READS_PER_EVENT,
} from '@/ee/security/boundary-crossing/sensitive-read'

const BUILT_IN = [
  '~/.aws/credentials',
  '~/.netrc',
  '~/.pgpass',
  '~/.kube/config',
  '~/.git-credentials',
  '~/.docker/config.json',
  '~/.config/gh/hosts.yml',
]

const bashEvent = (command: string) => ({
  toolName: 'Bash',
  filePath: null,
  payload: { tool_input: { command } },
})

describe('LUM-1036 (a) reads past the cap stay visible', () => {
  it('names every path past the cap on the last kept crossing', () => {
    const reads = detectCrossings(
      bashEvent(`cat ${BUILT_IN.join(' ')}`)
    ).filter(c => c.category === 'SENSITIVE_PATH_READ')
    expect(reads).toHaveLength(MAX_SENSITIVE_READS_PER_EVENT)
    const last = reads[reads.length - 1]!
    const overflow = BUILT_IN.slice(MAX_SENSITIVE_READS_PER_EVENT)
    expect(last.detail).toContain(`+${overflow.length} more in this command`)
    for (const p of overflow) expect(last.detail).toContain(p)
    // Only the last crossing carries the overflow note.
    for (const c of reads.slice(0, -1))
      expect(c.detail).not.toContain('more in this command')
  })

  it('at or under the cap, no overflow note', () => {
    const cmd = `cat ${BUILT_IN.slice(0, MAX_SENSITIVE_READS_PER_EVENT).join(' ')}`
    const matches = detectSensitiveReads({
      toolName: 'Bash',
      filePath: null,
      command: cmd,
    })
    expect(matches).toHaveLength(MAX_SENSITIVE_READS_PER_EVENT)
    expect(matches.every(m => m.alsoRead === undefined)).toBe(true)
  })
})

describe('LUM-1036 (b) project-rule reads are capped on their own list', () => {
  it('a project-rule path after five built-in reads is still reported', () => {
    const projectPath = '/opt/configs/api_tokens.json'
    const cmd = `cat ${BUILT_IN.slice(0, MAX_SENSITIVE_READS_PER_EVENT).join(' ')} ${projectPath}`
    const out = detectProjectSensitiveReads(
      { toolName: 'Bash', filePath: null, command: cmd },
      [{ glob: '/opt/configs/*.json', ruleId: 'rule-1', ruleText: 'configs' }]
    )
    expect(out.map(m => m.path)).toEqual([projectPath])
    expect(out[0]!.ruleId).toBe('rule-1')
  })
})
