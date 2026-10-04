import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'

// LUM-967: the bare warning / danger accents are stroke colours. In light mode
// they measure ~2.2:1 and ~3.8:1 on the page background, so they miss WCAG AA
// as text; coloured text uses the darker `-text` step (LUM-934, locked by
// feedback-contrast.test.ts). This guard keeps the bare accent utilities from
// creeping back onto text.
//
// It cannot tell an icon from a paragraph by reading source, so it pins the
// audited non-text sites instead: every file that still uses the bare utility
// is listed below with the number of uses it may keep and why. A new use
// anywhere else fails — the author then either switches to the `-text`
// utility (text, including a chip whose icon shares currentColor with its
// label) or, for a genuine icon / caret / decoration (WCAG non-text 3:1),
// adds or raises the entry here with the reason.

const ROOT = join(__dirname, '../..')
const SCAN_DIRS = ['app', 'components', 'lib']
const EXTS = new Set(['.ts', '.tsx'])
const BARE = /(?<![\w-])text-(warning|danger)(?![\w-])/g

const NON_TEXT_ALLOWANCE: Record<string, { max: number; why: string }> = {
  'app/workspace/[workspaceUrl]/components/GitHubAccessNotices.tsx': {
    max: 2,
    why: 'AlertTriangle icons; the notice text is text-foreground',
  },
  'app/workspace/[workspaceUrl]/components/GitHubIntegrationCard.tsx': {
    max: 1,
    why: 'AlertTriangle icon beside text-foreground copy',
  },
  'app/workspace/[workspaceUrl]/components/RangeBand.tsx': {
    max: 1,
    why: 'overflow caret svg on the range band',
  },
  'app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel.tsx':
    {
      max: 3,
      why: 'AlertTriangle / ShieldAlert / Lightbulb icons; their copy is muted text',
    },
  'app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem.tsx':
    { max: 3, why: 'ShieldAlert activity icons' },
  'app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectMilestonesOverview.tsx':
    { max: 3, why: 'milestone Flag markers and the pending Loader2 spinner' },
  'app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectPropertyRows.tsx':
    { max: 1, why: 'hover tint of the icon-only unlink (X) button' },
  'app/workspace/[workspaceUrl]/components/signal/StalePrList.tsx': {
    max: 1,
    why: 'GitPullRequest row icon',
  },
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXTS.has(extname(entry.name))) out.push(full)
  }
}

function bareUsesByFile(): Record<string, number> {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files)
  const counts: Record<string, number> = {}
  for (const f of files) {
    const n = readFileSync(f, 'utf8').match(BARE)?.length ?? 0
    if (n > 0) counts[relative(ROOT, f).split(sep).join('/')] = n
  }
  return counts
}

describe('LUM-967 bare warning/danger text utilities', () => {
  const counts = bareUsesByFile()

  it('only the audited non-text sites keep the bare accent utility', () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (NON_TEXT_ALLOWANCE[file]?.max ?? 0))
      .map(
        ([file, n]) =>
          `${file}: ${n} use(s), allowed ${NON_TEXT_ALLOWANCE[file]?.max ?? 0}`
      )
    expect(over).toEqual([])
  })

  it('every allowance entry still points at a live file (no stale slack)', () => {
    const stale = Object.keys(NON_TEXT_ALLOWANCE).filter(f => !(f in counts))
    expect(stale).toEqual([])
  })

  it('the regex sees the readable -text utilities as distinct', () => {
    expect('text-warning-text text-danger-text'.match(BARE)).toBeNull()
    expect('hover:text-danger x'.match(BARE)).toHaveLength(1)
  })
})
