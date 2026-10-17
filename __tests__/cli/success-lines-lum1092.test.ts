/**
 * @jest-environment node
 *
 * LUM-1092 — one success-line shape (`<Verb> <kind> <ref> "<title>"  <id>`)
 * and one hint prefix across commands; the agent-parsed first lines of
 * `task create` / `task update` / `doc create` stay byte-identical.
 */
import { formatCreatedTaskLine } from '../../cli/src/commands/task-create'
import { formatUpdatedTaskLine } from '../../cli/src/commands/task-update'
import { formatCreatedDocLine } from '../../cli/src/commands/doc-create'
import { formatCreatedTagLine } from '../../cli/src/commands/tag'
import { formatCreatedProjectLine } from '../../cli/src/commands/project-manage'
import { formatCreatedMilestoneLine } from '../../cli/src/commands/milestone-create'
import { formatCreatedSprintLine } from '../../cli/src/commands/sprint-create'
import {
  formatDepsAdded,
  formatDepsConfirmed,
  formatDepsDismissed,
  formatDepsRemoved,
  type DepEdge,
} from '../../cli/src/commands/task-deps'
import {
  formatTemplateCreatedLine,
  templateCreatedNextSteps,
} from '../../cli/src/commands/task-template-manage'
import { formatBackgroundHint } from '../../cli/src/commands/session-attach'
import { formatNextOutput } from '../../cli/src/commands/next'
import { formatImportedLine } from '../../cli/src/commands/doc-import-gdoc'
import { AUTH_LOGIN_HINT } from '../../cli/src/lib/auth-failure'
import { CODEX_SANDBOX_NETWORK_HINT } from '../../cli/src/lib/codex-rules'

const TRICKY = 'Fix "quoted" 标题\u001b[31m'

describe('agent-parsed first lines are byte-identical (regression)', () => {
  const base = {
    id: 'id-1',
    identifier: 'LUM-7',
    title: TRICKY,
    url: 'https://lumo.test/t/LUM-7',
  }

  it('task create', () => {
    expect(formatCreatedTaskLine(base)).toBe(
      'Created LUM-7 "Fix \\"quoted\\" 标题[31m"  https://lumo.test/t/LUM-7'
    )
    expect(formatCreatedTaskLine({ ...base, tags: ['a', 'b'] })).toBe(
      'Created LUM-7 "Fix \\"quoted\\" 标题[31m"  https://lumo.test/t/LUM-7\nTags: a, b'
    )
  })

  it('task update', () => {
    expect(formatUpdatedTaskLine(base)).toBe(
      'Updated LUM-7 "Fix \\"quoted\\" 标题[31m"  https://lumo.test/t/LUM-7'
    )
  })

  it('doc create', () => {
    expect(
      formatCreatedDocLine({
        id: 'doc-1',
        title: TRICKY,
        url: 'https://lumo.test/d/1',
      })
    ).toBe('Created doc-1 "Fix \\"quoted\\" 标题[31m"  https://lumo.test/d/1')
  })
})

describe('success lines share one shape', () => {
  it('tag create: id after two spaces, no parentheses', () => {
    expect(formatCreatedTagLine({ id: 'tag_1', name: 'ui' })).toBe(
      'Created tag "ui"  tag_1'
    )
  })

  it('project create: id after two spaces, no parentheses', () => {
    expect(formatCreatedProjectLine({ id: 'p_1', name: 'Core' })).toBe(
      'Created project "Core"  p_1'
    )
  })

  it('milestone / sprint create keep their documented lines', () => {
    // LUM-1230: the trailing handle is the slug, not the cuid.
    expect(
      formatCreatedMilestoneLine({
        id: 'm-1',
        name: 'Q3 Launch',
        slug: 'q3-launch',
      })
    ).toBe('Created milestone "Q3 Launch"  q3-launch')
    expect(
      formatCreatedSprintLine({ id: 'sp-3', number: 3, name: 'Sprint 3' })
    ).toBe('Created sprint #3 "Sprint 3"  sp-3')
  })

  const edge: DepEdge = {
    id: 'a1b2c3d4e5f6',
    direction: 'BLOCKED_BY',
    kind: 'MANUAL',
    source: 'manual',
    status: 'SUGGESTED',
    reason: null,
    detail: null,
    other: { identifier: 'LUM-9', title: 'Add "OAuth"', status: 'TODO' },
  }

  it('task deps: <Verb> dependency …', () => {
    expect(formatDepsAdded('LUM-42', 'LUM-9')).toBe(
      'Added dependency LUM-42 blocked by LUM-9'
    )
    expect(formatDepsConfirmed('LUM-42', edge, true)).toBe(
      'Confirmed dependency [a1b2c3d4] LUM-42 blocked by LUM-9 "Add \\"OAuth\\"" (reversed)'
    )
    expect(formatDepsDismissed(edge)).toBe(
      'Dismissed dependency [a1b2c3d4] LUM-9 "Add \\"OAuth\\"" (won\'t be suggested again)'
    )
    expect(formatDepsRemoved('LUM-42', edge)).toBe(
      'Removed dependency [a1b2c3d4] from LUM-42'
    )
  })

  it('task deps add strips control characters from the user-typed ref', () => {
    expect(formatDepsAdded('LUM-42', 'LUM-9\u001b[2J')).toBe(
      'Added dependency LUM-42 blocked by LUM-9[2J'
    )
  })

  it('task template create: success line, usage moves to Next:', () => {
    expect(
      formatTemplateCreatedLine({
        key: 'brief',
        name: 'Brief',
        content: 'x'.repeat(1200),
      })
    ).toBe('Created task template brief "Brief" (1,200 chars)')
    expect(templateCreatedNextSteps('brief')).toEqual([
      {
        command: 'lumo task create <title> --template brief',
        why: 'create a task from this template',
      },
    ])
    expect(templateCreatedNextSteps('k\u001b[2J')[0]?.command).toBe(
      'lumo task create <title> --template k[2J'
    )
  })
})

describe('hints share one prefix and backticked commands', () => {
  it('session attach background pointer', () => {
    expect(formatBackgroundHint('LUM-42')).toBe(
      'Hint: run `lumo task context LUM-42` for background (team memory, test cases, sources, prior sessions)'
    )
  })

  it('auth and Codex sandbox hints use the Hint: prefix', () => {
    expect(AUTH_LOGIN_HINT.startsWith('Hint: ')).toBe(true)
    expect(CODEX_SANDBOX_NETWORK_HINT.startsWith('Hint: ')).toBe(true)
  })

  it('gdoc import over-share reminder is a ⚠ warning, not Note:', () => {
    const out = formatImportedLine({ id: 'd1', title: 'T', url: 'u' })
    expect(out.split('\n')[1]).toBe(
      '⚠ imported content follows Lumo sharing and is no longer gated by Google permissions.'
    )
    expect(out).not.toContain('Note:')
  })
})

describe('lumo next has no hard-coded LUM prefix', () => {
  it('uses a prefix-neutral pointer', () => {
    const task = (identifier: string) => ({
      identifier,
      task: { status: 'TODO', priority: 'HIGH', title: 't' },
      reasons: ['r'],
      score: 1,
    })
    const out = formatNextOutput([task('SPEC-1'), task('SPEC-2')] as never, 2)
    expect(out).toContain('(or pick any other task from the list)')
    expect(out).not.toContain('LUM')
  })
})
