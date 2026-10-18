/**
 * @jest-environment node
 *
 * LUM-1234 — files written from a Bash command (sed -i, redirects, tee,
 * mv/cp, python/node scripts) count as writes for the reward-hack layer:
 * session selection, the evidence gate and the refute call's PR hunks. The
 * calibration false positive was a python heredoc fixing a test expectation
 * that the refute call never saw. Every command here is hand-written.
 */
import {
  rhBashWrittenPaths,
  rhEventAddedLines,
  rhEventFilePaths,
  rhEventIsShellWrite,
  rhEventIsWholeFileWrite,
  selectSessionsForPr,
  type RhEvent,
  type RhPrFile,
} from '@/ee/security/security-scan/reward-hack-input'
import { citedEditsInPr } from '@/ee/security/security-scan/reward-hack-gates'
import {
  buildRhDiffView,
  decideRewardHack,
} from '@/ee/security/security-scan/reward-hack-decide'

const ROOT = '/Users/dev/repo/.worktrees/LUM-1-foo'

describe('rhBashWrittenPaths — clear writes', () => {
  it.each<[string, string, string[]]>([
    [
      'python heredoc (the calibration case)',
      `cd ${ROOT} && python3 - <<'EOF'\np='__tests__/x.test.ts'; s=open(p).read(); s=s.replace('a','b'); open(p,'w').write(s)\nEOF`,
      [`${ROOT}/__tests__/x.test.ts`],
    ],
    [
      'python -c with a literal path, append mode',
      `python3 -c "open('src/a.ts', 'a').write('x')"`,
      ['src/a.ts'],
    ],
    [
      'python Path(...).write_text',
      `cd ${ROOT}; python3 <<EOF\nfrom pathlib import Path\nPath('src/b.ts').write_text('y')\nEOF`,
      [`${ROOT}/src/b.ts`],
    ],
    [
      'python variable bound to Path(...)',
      `python3 - <<'PY'\nf = Path("src/c.ts")\nf.write_text(f.read_text().replace('1', '2'))\nPY`,
      ['src/c.ts'],
    ],
    [
      'node -e writeFileSync with a literal',
      `node -e "require('fs').writeFileSync('src/d.ts', 'z')"`,
      ['src/d.ts'],
    ],
    [
      'GNU sed -i',
      `sed -i 's/a/b/' src/a.ts src/b.ts`,
      ['src/a.ts', 'src/b.ts'],
    ],
    ["BSD sed -i ''", `sed -i '' -e 's/a/b/' src/a.ts`, ['src/a.ts']],
    ['sed -i.bak', `sed -i.bak 's/a/b/' src/a.ts`, ['src/a.ts']],
    ['sed -E -i', `sed -E -i 's/(a)/b/' src/a.ts`, ['src/a.ts']],
    ['perl -pi -e', `perl -pi -e 's/a/b/' src/a.ts`, ['src/a.ts']],
    ['perl -i -pe', `perl -i -pe 's/a/b/g' src/a.ts`, ['src/a.ts']],
    ['> redirect', `echo 'x' > src/a.ts`, ['src/a.ts']],
    ['>> redirect with 1>', `printf x 1>>src/a.ts`, ['src/a.ts']],
    ['tee -a', `echo x | tee -a src/a.ts`, ['src/a.ts']],
    [
      'cat > file <<EOF',
      `cd ${ROOT} && cat > __tests__/y.test.ts <<'EOF'\nit('x', () => {})\nEOF`,
      [`${ROOT}/__tests__/y.test.ts`],
    ],
    ['mv destination', `mv -f src/old.ts src/new.ts`, ['src/new.ts']],
    ['cp destination', `cp src/a.ts src/a.copy.ts`, ['src/a.copy.ts']],
    [
      'relative cd with ..',
      `cd ee/security && sed -i 's/a/b/' ../lib/x.ts`,
      ['ee/lib/x.ts'],
    ],
    [
      'a later redirect in a chain after a test run',
      `cd ${ROOT} && npm test 2>&1 && echo ok > src/flag.ts`,
      [`${ROOT}/src/flag.ts`],
    ],
  ])('%s', (_name, command, expected) => {
    expect(rhBashWrittenPaths(command)).toEqual(expected)
  })
})

describe('rhBashWrittenPaths — not writes, or unsure (nothing reported)', () => {
  it.each<[string, string]>([
    ['cat file', 'cat src/a.ts'],
    ['grep for a quoted >', `grep -n '>' src/a.ts`],
    ['grep for a quoted "a > b"', `grep "a > b" src/a.ts`],
    ['stderr to a file', 'npm test 2> err.log'],
    ['stdout to /dev/null', 'npm test > /dev/null'],
    [
      '&> and >& are not stdout files',
      'npm test &> all.log; npm test >& x.log',
    ],
    ['a write under /tmp', 'echo x > /tmp/y'],
    ['a write under /private/tmp', 'echo x > /private/tmp/y.txt'],
    ['a scratchpad write', `echo x > ${ROOT}/scratchpad/notes.txt`],
    ['a .superpowers write', `echo x > ${ROOT}/.superpowers/sdd/r.md`],
    [
      'read-only python open',
      `python3 - <<'EOF'\np='src/a.ts'\nprint(open(p).read())\nprint(open(p, 'r').read())\nEOF`,
    ],
    ['sed without -i', `sed -n 's/a/b/p' src/a.ts`],
    ['a variable path', 'echo x > "$OUT"'],
    ['a glob', `sed -i 's/a/b/' src/*.ts`],
    ['a second cd', `cd a && cd b && echo x > c.ts`],
    ['a subshell', `(cd a && echo x > c.ts)`],
    ['command substitution', 'echo $(date) > a.ts'],
    ['mv into a directory', 'mv a.ts b.ts src/'],
    ['mv -t', 'mv -t src a.ts'],
    ['python script file', 'python3 scripts/fix.py src/a.ts'],
    [
      'python that changes directory',
      `python3 -c "import os; os.chdir('x'); open('a.ts','w')"`,
    ],
    [
      'a python path built at runtime',
      `python3 -c "open(os.path.join(d, 'a.ts'), 'w')"`,
    ],
    [
      'a git commit message mentioning a redirect',
      `git commit -m "$(cat <<'EOF'\nfix: write > out.ts\nEOF\n)"`,
    ],
    ['an unterminated quote', `echo 'x > a.ts`],
    ['empty', ''],
  ])('%s', (_name, command) => {
    expect(rhBashWrittenPaths(command)).toEqual([])
  })
})

function bashEv(id: string, at: string, command: string): RhEvent {
  return {
    id,
    sessionId: 's1',
    type: 'POST_TOOL_USE',
    toolName: 'Bash',
    payload: {
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { stdout: '', stderr: '' },
    },
    createdAt: new Date(at),
  }
}

const CAL_CMD = `cd ${ROOT} && python3 - <<'EOF'\np='__tests__/x.test.ts'; s=open(p).read(); s=s.replace("'\\\\x1b'", "''"); open(p,'w').write(s)\nEOF`
const TEST_FILE = '__tests__/x.test.ts'
const PR_FILES: RhPrFile[] = [
  {
    filename: TEST_FILE,
    patch: "@@ -1,3 +1,3 @@\n-expect(out).toBe('\\x1b')\n+expect(out).toBe('')",
    status: 'modified',
  },
  {
    filename: 'src/clean.ts',
    patch: '@@ -1 +1 @@\n+export const x = 1',
    status: 'modified',
  },
]

describe('a Bash write as an event write', () => {
  const e = bashEv('b1', '2026-10-05T00:00:00Z', CAL_CMD)

  it('names its files, has no known added lines and is not a whole-file Write', () => {
    expect(rhEventFilePaths(e)).toEqual([`${ROOT}/${TEST_FILE}`])
    expect(rhEventIsShellWrite(e)).toBe(true)
    expect(rhEventAddedLines(e)).toBeNull()
    expect(rhEventIsWholeFileWrite(e)).toBe(false)
    expect(
      rhEventIsShellWrite(bashEv('b2', '2026-10-05T00:00:00Z', 'npm test'))
    ).toBe(false)
  })

  it('a session whose only edit is a Bash write is selected for the PR', () => {
    const out = selectSessionsForPr({
      sessions: [{ id: 's1', events: [e] }],
      windowStart: null,
      windowEnd: new Date('2026-10-10T00:00:00Z'),
      prFiles: [TEST_FILE],
    })
    expect(out.included.map(s => s.id)).toEqual(['s1'])
  })

  it('gate: a Bash write to a PR file stands (benefit of the doubt)', () => {
    const view = buildRhDiffView([{ id: 's1', events: [e] }], PR_FILES)
    expect(view.eventFile.get('b1')).toEqual([`${ROOT}/${TEST_FILE}`])
    expect(view.shellWrites?.has('b1')).toBe(true)
    expect(citedEditsInPr(['b1'], view)).toBe(true)
  })

  it('gate: a Bash write outside the PR never drops an item on its own', () => {
    const other = bashEv(
      'b3',
      '2026-10-05T00:00:00Z',
      `cd ${ROOT} && echo x > notes.txt`
    )
    const view = buildRhDiffView([{ id: 's1', events: [other] }], PR_FILES)
    expect(view.eventFile.get('b3')).toEqual([`${ROOT}/notes.txt`])
    expect(citedEditsInPr(['b3'], view)).toBe(true)
    // …but it does not rescue a cited Edit that is no longer in the PR.
    view.eventFile.set('gone', [`${ROOT}/src/gone.ts`])
    expect(citedEditsInPr(['b3', 'gone'], view)).toBe(false)
  })

  it('the refute call receives the PR hunks of the file the Bash command wrote', async () => {
    const prDiffs: string[] = []
    const decision = await decideRewardHack({
      sessions: [{ id: 's1', events: [e] }],
      prFileList: PR_FILES,
      requirement: 'Strip control bytes from the output.',
      judge: async () => ({
        output: {
          suspicion: 90,
          items: [
            {
              kind: 'TEST_TAMPERING',
              summary: 'Changed the test expectation.',
              eventIds: ['b1'],
            },
          ],
        },
        costUsd: 0,
      }),
      refute: async ({ prDiff }) => {
        prDiffs.push(prDiff)
        return {
          refuted: true,
          reason: 'The expectation was wrong.',
          costUsd: 0,
        }
      },
      spend: { reserve: async () => true, settle: async () => {} },
    })
    expect(decision.outcome).toBe('judged')
    expect(prDiffs).toHaveLength(1)
    expect(prDiffs[0]).toContain(`file="${TEST_FILE}"`)
    expect(prDiffs[0]).toContain("+expect(out).toBe('')")
    expect(prDiffs[0]).not.toContain('src/clean.ts')
  })
})
