/**
 * LUM-1232 batch F — the `Examples:` and `Exit codes:` sections of `--help`
 * (docs/cli-output-conventions.md HT-1). Data only; `attachHelpSections()`
 * hangs them on the Commander tree. Every example is checked against the CLI
 * grammar by scripts/cli-grammar/__tests__/doc-examples.test.ts, so a flag
 * that does not exist cannot ship here.
 */

/** Command path (`task testcase run`) → 1–3 complete invocations. */
export const HELP_EXAMPLES: Readonly<Record<string, readonly string[]>> = {
  'task list': [
    'lumo task list',
    'lumo task list --status in_progress --limit 10',
    'lumo task list --cursor 50',
  ],
  'task search': [
    'lumo task search "oauth redirect"',
    'lumo task search --status todo --priority high',
  ],
  'task show': [
    'lumo task show LUM-42',
    'lumo task show LUM-42 --full',
    'lumo task show LUM-42 --comments --history',
    'lumo task show --scans --all',
  ],
  'task status': ['lumo task status LUM-42', 'lumo task status LUM-42 --full'],
  'task create': [
    'lumo task create "Fix the login redirect" --priority high',
    'lumo task create "Spike: cache layer" --template agent-brief',
  ],
  'task update': [
    'lumo task update LUM-42 --status in_progress',
    'lumo task update LUM-42 --status done',
    'lumo task update LUM-42 --priority urgent --add-tag security',
  ],
  'task comment': ['lumo task comment LUM-42 "Pushed the fix in #123"'],
  'task decide': [
    'lumo task decide LUM-42 "Keep the v1 API; add v2 beside it"',
  ],
  'task deps add': ['lumo task deps add LUM-42 --blocked-by LUM-9'],
  'task pr show': ['lumo task pr show LUM-42 123'],
  'task testcase add': [
    'lumo task testcase add LUM-42 --title "Footer disclosure" --step "open: the dashboard" --expected "The footer shows the disclosure."',
  ],
  'task testcase list': ['lumo task testcase list LUM-42'],
  'task testcase show': ['lumo task testcase show LUM-42/TC3'],
  'milestone testcase list': ['lumo milestone testcase list headless-web-cli'],
  'milestone testcase show': [
    'lumo milestone testcase show headless-web-cli/TC3',
  ],
  'milestone testcase run': [
    'lumo milestone testcase run headless-web-cli/TC3 --result pass --env production --commit 0d46921 --step s1-2=pass',
  ],
  'task testcase run': [
    'lumo task testcase run LUM-42/TC3 --result pass --env local --step s1-2=pass',
    'lumo task testcase run LUM-42/TC3 --result fail --env local --cause defect --step s1=pass --step s2=fail',
  ],
  'memory add': [
    'lumo memory add --category decision --what "Use the queue" --why "Retries are free"',
    'lumo memory add --scope project --category convention --rule "CLI tag commands print Tags:" --applies "doc/task create and update"',
  ],
  'memory list': [
    'lumo memory list',
    'lumo memory list --scope project --category trap',
    'lumo memory list --learnings --repo owner/name',
  ],
  'task artifact add': [
    'lumo task artifact add LUM-42 --kind spec --title "Spec" --file docs/spec.md --source Superpowers --agent claude-code',
  ],
  'session attach': ['lumo session attach LUM-42'],
  'session status': ['lumo session status'],
  next: ['lumo next', 'lumo next --count 5', 'lumo next --claimable'],
  'crossing list': [
    'lumo crossing list LUM-42',
    'lumo crossing list LUM-42 --all',
  ],
  'crossing explain': [
    'lumo crossing explain LUM-X12 --task LUM-42 --note "The path is a test fixture"',
  ],
  'crossing disposition': [
    'lumo crossing disposition LUM-X12 --false-positive --task LUM-42',
  ],
  'pr show': ['lumo pr show 123', 'lumo pr show 123 --full'],
  'pr review': [
    'lumo pr review 123',
    'lumo pr review 123 --full',
    'lumo pr review 123 --pause',
  ],
  'milestone list': ['lumo milestone list', 'lumo milestone list --all'],
  'milestone show': ['lumo milestone show q3-launch'],
  'sprint list': ['lumo sprint list', 'lumo sprint list --status active'],
  'sprint show': ['lumo sprint show 13'],
  'doc list': ['lumo doc list', 'lumo doc list --scope workspace'],
  'doc show': [
    'lumo doc show runbook-12',
    'lumo doc show runbook-12 --raw',
    'lumo doc show runbook-12 --members',
  ],
  'doc update': [
    'lumo doc update runbook-12 --file docs/runbook.md',
    'lumo doc update runbook-12 --add-member alice@example.com --role editor',
    'lumo doc update runbook-12 --add-task LUM-42',
  ],
  'doc import': [
    'lumo doc import --gdoc https://docs.google.com/document/d/abc/edit --task LUM-42',
  ],
  'memory show': ['lumo memory show kp5brom5'],
  'worktree add': ['lumo worktree add LUM-42 fix-login'],
  'worktree list': ['lumo worktree list'],
  'usage show': [
    'lumo usage show --task LUM-42',
    'lumo usage show --since 2026-10-01 --by model',
    'lumo usage show --by member --tasks --since 2026-10-01 --until 2026-10-07',
  ],
  'usage resync': ['lumo usage resync --dry-run', 'lumo usage resync'],
  'inbox list': ['lumo inbox list'],
  'audit list': ['lumo audit list', 'lumo audit list --actor me --since 7d'],
  'project overview': ['lumo project overview lumo'],
  whoami: ['lumo whoami', 'lumo whoami --full'],
}

/**
 * Commands that can exit 4 (a confirmation envelope) or 5 (`DONE_BLOCKED`).
 * Their `--help` lists those codes; the general table is in `lumo --help`.
 */
export const EXIT_CODE_COMMANDS: Readonly<Record<string, readonly (4 | 5)[]>> =
  {
    'task update': [4, 5],
    'task delete': [4],
    'task deps rm': [4],
    'task artifact rm': [4],
    'task comments rm': [4],
    'task template rm': [4],
    'task testcase delete': [4],
    'milestone testcase delete': [4],
    'task testcase disposition': [4],
    'milestone testcase disposition': [4],
    'crossing disposition': [4],
    'finding disposition': [4],
    'memory delete': [4],
    'milestone delete': [4],
    'sprint close': [4],
    'sprint delete': [4],
    'doc delete': [4],
    'doc rebuild-source': [4],
    'worktree add': [4],
    'worktree rm': [4],
    'worktree prune': [4],
    'workspace security-scan': [4],
    uninstall: [4],
  }

const CODE_TEXT: Record<number, string> = {
  0: 'ok',
  1: 'failed',
  2: 'usage error',
  4: 'the user must confirm — relay the envelope, then re-run its confirmCommand',
  5: 'blocked by a human-only gate — relay it, do not retry',
}

/** The `Examples:` block for a command path, or '' when it has none. */
export function examplesHelp(path: string): string {
  const ex = HELP_EXAMPLES[path]
  if (!ex || ex.length === 0) return ''
  return ['', 'Examples:', ...ex.map(e => `  ${e}`)].join('\n')
}

/** The `Exit codes:` block for a command path that can exit 4 / 5, or ''. */
export function exitCodesHelp(path: string): string {
  const extra = EXIT_CODE_COMMANDS[path]
  if (!extra) return ''
  const codes = [0, 1, 2, ...extra]
  return ['', 'Exit codes:', ...codes.map(c => `  ${c}  ${CODE_TEXT[c]}`)].join(
    '\n'
  )
}

/** The general exit-code table `lumo --help` ends with. */
export function rootExitCodesHelp(): string {
  return [
    '',
    'Exit codes:',
    ...[0, 1, 2, 4, 5].map(c => `  ${c}  ${CODE_TEXT[c]}`),
  ].join('\n')
}

interface HelpNode {
  name(): string
  parent: unknown
  commands: readonly HelpNode[]
  addHelpText(position: 'after', text: string): unknown
}

function pathOf(cmd: HelpNode): string {
  const names: string[] = []
  let node: HelpNode | null = cmd
  while (node && node.parent) {
    names.unshift(node.name())
    node = node.parent as HelpNode | null
  }
  return names.join(' ')
}

/**
 * Hang the Examples / Exit codes sections on every command that has them,
 * and the exit-code table on the root. Returns the paths it touched.
 */
export function attachHelpSections(root: HelpNode): string[] {
  const touched: string[] = []
  root.addHelpText('after', rootExitCodesHelp())
  const walk = (node: HelpNode) => {
    for (const c of node.commands) {
      const path = pathOf(c)
      // A blank line between the two sections when a command has both.
      const text = [examplesHelp(path), exitCodesHelp(path)]
        .filter(Boolean)
        .join('\n')
      if (text) {
        c.addHelpText('after', text)
        touched.push(path)
      }
      walk(c)
    }
  }
  walk(root)
  return touched
}
