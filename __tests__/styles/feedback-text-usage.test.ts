import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'

// LUM-967 / LUM-969: the bare feedback accents are stroke colours. In light
// mode they miss WCAG AA as text on the page background (success ~2.3:1,
// warning ~2.2:1, info ~3.7:1, danger / destructive ~3.8:1, in-review ~4.2:1),
// so coloured text uses the darker `-text` step (LUM-934 / LUM-969, locked by
// feedback-contrast.test.ts). Destructive text uses `text-danger-text` — the
// two reds share the light value and the meaning. This guard keeps the bare
// accent utilities from creeping back onto text.
//
// It cannot tell an icon from a paragraph by reading source, so it pins the
// audited non-text sites instead: every file that still uses a bare utility
// is listed under its family with the number of uses it may keep and why. A
// new use anywhere else fails — the author then either switches to the `-text`
// utility (text, including a chip whose icon shares currentColor with its
// label) or, for a genuine icon / caret / decoration (WCAG non-text 3:1),
// adds or raises the entry here with the reason.
//
// success and warning have NO allowance: their light accents measure below
// 3:1 even as icons, so icons use the `-text` step as well (LUM-969).

const ROOT = join(__dirname, '../..')
const SCAN_DIRS = ['app', 'components', 'lib']
const EXTS = new Set(['.ts', '.tsx'])

const FAMILIES = [
  'warning',
  'danger',
  'success',
  'info',
  'destructive',
  'status-in-review',
] as const
type Family = (typeof FAMILIES)[number]

/** The bare utility for a family, plus its arbitrary var() spelling. */
function bareRe(family: Family): RegExp {
  return new RegExp(
    `(?<![\\w-])text-(?:${family}|\\[var\\(--${family}\\)\\])(?![\\w-])`,
    'g'
  )
}

type Allowance = Record<string, { max: number; why: string }>

const W = 'app/workspace/[workspaceUrl]/components'

const NON_TEXT_ALLOWANCE: Record<Family, Allowance> = {
  warning: {},
  success: {},
  danger: {
    [`${W}/TaskDetailTimeline/BoundaryCrossingsPanel.tsx`]: {
      max: 1,
      why: 'AlertTriangle icon in the crossings header',
    },
    [`${W}/pages/project-detail/ProjectPropertyRows.tsx`]: {
      max: 1,
      why: 'hover tint of the icon-only unlink (X) button',
    },
  },
  info: {
    [`${W}/PrBadge.tsx`]: {
      max: 1,
      why: 'open-PR glyph svg (icon only, label is aria-label / title)',
    },
    [`${W}/RangeBand.tsx`]: {
      max: 1,
      why: 'overflow caret svg on the range band',
    },
  },
  destructive: {
    [`${W}/BubbleMenuBar.tsx`]: {
      max: 1,
      why: 'hover tint of the icon-only remove-link button',
    },
    [`${W}/SpecArtifactGroup.tsx`]: {
      max: 1,
      why: 'hover tint of the icon-only delete (Trash2) button',
    },
    [`${W}/TaskDependencyField.tsx`]: {
      max: 1,
      why: 'Ban blocked-indicator icon (sr-only label)',
    },
    [`${W}/TaskDetailHeader.tsx`]: {
      max: 2,
      why: 'AlertDialogMedia Trash2 icon tile',
    },
    [`${W}/data-table/task-columns.tsx`]: {
      max: 2,
      why: 'AlertDialogMedia Trash2 icon tile',
    },
    [`${W}/pages/project-detail/ProjectHeader.tsx`]: {
      max: 2,
      why: 'AlertDialogMedia Trash2 icon tile',
    },
    [`${W}/bubble-menu/ToolbarButton.tsx`]: {
      max: 4,
      why: 'icon-only toolbar button (active / hover tints, light + dark)',
    },
    [`${W}/pages/ApiKeysPage.tsx`]: {
      max: 1,
      why: 'hover tint of the icon-only revoke (Trash2) button',
    },
    'app/workspace/[workspaceUrl]/dependencies/components/DependencyRow.tsx': {
      max: 1,
      why: 'hover tint of the icon-only remove (X) button',
    },
    'components/ui/alert.tsx': {
      max: 1,
      why: 'destructive Alert icon ([&>svg]); the alert text is danger-text',
    },
  },
  'status-in-review': {
    [`${W}/StatusIcon.tsx`]: {
      max: 1,
      why: 'IN_REVIEW status glyph svg',
    },
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

const SOURCES: Array<{ file: string; text: string }> = (() => {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files)
  return files.map(f => ({
    file: relative(ROOT, f).split(sep).join('/'),
    text: readFileSync(f, 'utf8'),
  }))
})()

function bareUsesByFile(family: Family): Record<string, number> {
  const re = bareRe(family)
  const counts: Record<string, number> = {}
  for (const { file, text } of SOURCES) {
    const n = text.match(re)?.length ?? 0
    if (n > 0) counts[file] = n
  }
  return counts
}

describe('LUM-967 / LUM-969 bare feedback text utilities', () => {
  it.each(FAMILIES)(
    'only the audited non-text sites keep bare text-%s',
    family => {
      const allowance = NON_TEXT_ALLOWANCE[family]
      const over = Object.entries(bareUsesByFile(family))
        .filter(([file, n]) => n > (allowance[file]?.max ?? 0))
        .map(
          ([file, n]) =>
            `${file}: ${n} use(s), allowed ${allowance[file]?.max ?? 0}`
        )
      expect(over).toEqual([])
    }
  )

  it.each(FAMILIES)(
    'every text-%s allowance entry still points at a live use (no stale slack)',
    family => {
      const counts = bareUsesByFile(family)
      const stale = Object.keys(NON_TEXT_ALLOWANCE[family]).filter(
        f => !(f in counts)
      )
      expect(stale).toEqual([])
    }
  )

  it('success and warning keep no bare uses at all (accent < 3:1 on light)', () => {
    expect(bareUsesByFile('success')).toEqual({})
    expect(bareUsesByFile('warning')).toEqual({})
  })

  it('globals.css never colours text with a bare feedback accent', () => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
    const hits = css.match(
      /(?<![\w-])color:\s*var\(--(?:success|info|warning|danger|destructive)\)/g
    )
    expect(hits).toBeNull()
  })

  it('the regex sees the readable -text utilities as distinct', () => {
    const all = FAMILIES.map(f => `text-${f}-text`).join(' ')
    for (const f of FAMILIES) expect(all.match(bareRe(f))).toBeNull()
    expect('hover:text-danger x'.match(bareRe('danger'))).toHaveLength(1)
    expect(
      'focus:text-destructive x'.match(bareRe('destructive'))
    ).toHaveLength(1)
    expect(
      'text-destructive-foreground'.match(bareRe('destructive'))
    ).toBeNull()
    expect('text-[var(--danger)]'.match(bareRe('danger'))).toHaveLength(1)
    expect(
      'text-status-in-review'.match(bareRe('status-in-review'))
    ).toHaveLength(1)
  })
})

// LUM-968: the same light-mode gap applies to SVG marks and dots painted with
// a bare success / warning accent (~2.2:1, below non-text 3:1). Chart strokes,
// fills and the arbitrary var() background use the -text step instead. The
// pattern is assembled from parts so this file never spells a utility.
describe('LUM-968 bare success / warning chart marks', () => {
  const fams = '(?:success|warning)'
  const markRe = new RegExp(
    `(?<![\\w-])(?:stroke|fill)-${fams}(?![\\w-])|bg-\\[var\\(--${fams}\\)\\]`
  )

  it('no stroke / fill / var() background uses a bare success or warning accent', () => {
    const hits = SOURCES.filter(({ text }) => markRe.test(text)).map(
      ({ file }) => file
    )
    expect(hits).toEqual([])
  })

  it('the pattern matches the bare marks and skips the -text step', () => {
    const bare = ['stroke', 'fill'].map(p => `${p}-success`)
    for (const c of bare) expect(c.match(markRe)).toHaveLength(1)
    expect(['bg-[var(--', 'warning)]'].join('').match(markRe)).toHaveLength(1)
    expect(['stroke', 'success', 'text'].join('-').match(markRe)).toBeNull()
  })
})
