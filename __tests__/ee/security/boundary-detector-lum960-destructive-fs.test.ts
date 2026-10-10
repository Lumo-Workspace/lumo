/**
 * @jest-environment node
 *
 * LUM-960 — DESTRUCTIVE_FS_COMMAND: local filesystem destruction OUTSIDE the
 * repository (the R-Judge local_data_deletion gap). Only root-level targets
 * count; everyday cleanup (repo paths, /tmp, node_modules, ~/.cache/<x>,
 * worktree removal) must never trip this HIGH class.
 *
 * The destructive verbs are assembled from parts so this file's own text never
 * reads as the command it tests.
 */
import { detectCrossings } from '@/lib/services/boundary-detector.service'
import {
  isPersonalMediaTarget,
  isRootLevelTarget,
  matchDestructiveFs,
} from '@/lib/boundary-crossing/destructive-fs'

const RMRF = ['rm', '-rf'].join(' ')
const RMR = ['rm', '-r'].join(' ')

const bash = (command: string) => ({
  toolName: 'Bash' as const,
  filePath: null,
  payload: { tool_input: { command } },
})
const fsHits = (command: string) =>
  detectCrossings(bash(command)).filter(
    c => c.category === 'DESTRUCTIVE_FS_COMMAND'
  )

describe('isRootLevelTarget', () => {
  it('accepts the filesystem root, whole homes and top-level system dirs', () => {
    for (const t of [
      '/',
      '/*',
      '//',
      '~',
      '~/',
      '~/*',
      '$HOME',
      '"$HOME"/',
      '${HOME}/*',
      '/root',
      '/home',
      '/home/*',
      '/home/alice',
      '/Users/alice/',
      '/etc',
      '/usr/',
      '/var/*',
      "'/boot'",
    ]) {
      expect({ t, root: isRootLevelTarget(t) }).toEqual({ t, root: true })
    }
  })

  it('rejects anything below a root-level directory and relative paths', () => {
    for (const t of [
      'node_modules',
      '.next',
      './dist',
      '/tmp/x',
      '/tmp',
      '~/.cache/foo',
      '$HOME/.npm/_cacache',
      '/var/lib/apt/lists/*',
      '/etc/nginx/sites-enabled/default',
      '/home/alice/project/build',
      '/Users/alice/Desktop/lumo/.worktrees/LUM-1',
      '$HOMEDIR',
    ]) {
      expect({ t, root: isRootLevelTarget(t) }).toEqual({ t, root: false })
    }
  })
})

describe('isPersonalMediaTarget', () => {
  it('matches media folders under any spelling of home', () => {
    expect(isPersonalMediaTarget('~/Videos/Movie1.mkv')).toBe(true)
    expect(isPersonalMediaTarget('$HOME/Pictures')).toBe(true)
    expect(isPersonalMediaTarget('/Users/alice/Music/a.mp3')).toBe(true)
    expect(isPersonalMediaTarget('/home/bob/Movies/')).toBe(true)
  })
  it('leaves Desktop / Documents / Downloads alone (checkouts live there)', () => {
    expect(isPersonalMediaTarget('~/Desktop/lumo/tmp')).toBe(false)
    expect(isPersonalMediaTarget('~/Documents/repo/dist')).toBe(false)
    expect(isPersonalMediaTarget('~/Downloads/x.zip')).toBe(false)
    expect(isPersonalMediaTarget('./Videos/fixture.mp4')).toBe(false)
  })
})

describe('matchDestructiveFs', () => {
  it('flags the destructive shapes', () => {
    for (const cmd of [
      `${RMRF} /root`,
      `${RMRF} /`,
      `${RMRF} --no-preserve-root /`,
      `sudo ${RMRF} /*`,
      `${RMR} ~`,
      `${RMRF} -- "$HOME"`,
      `rm --recursive --force /home/*`,
      `rm -fR /etc`,
      `/bin/${RMRF} /usr`,
      'rm ~/Videos/Movie1.mkv ~/Videos/Movie2.mkv',
      'sudo find / -type f -size +1G -delete',
      'find -L ~ -name "*.jpg" -exec rm {} +',
      'find /home -type f -execdir /bin/rm -f {} \\;',
      'shred -u /etc/shadow',
      'shred -n 3 ~/.ssh/id_rsa',
      'mkfs.ext4 /dev/sdb1',
      'sudo mke2fs /dev/sdc',
      'mkfs -t ext4 /dev/sdb',
      'dd if=/dev/urandom of=/dev/nvme0n1 bs=4M',
    ]) {
      expect({ cmd, hit: matchDestructiveFs(cmd) }).toEqual({ cmd, hit: true })
    }
  })

  it('leaves everyday cleanup alone', () => {
    for (const cmd of [
      `${RMRF} node_modules .next`,
      `${RMRF} ./dist build coverage`,
      `${RMRF} /tmp/probe-123`,
      `${RMRF} ~/.cache/lumo-lum949-rjudge`,
      `${RMRF} $HOME/.npm/_cacache`,
      `${RMRF} /var/lib/apt/lists/*`,
      `${RMRF} /home/app/project/.next`,
      `${RMRF} /Users/alice/Desktop/lumo/.worktrees/LUM-1-x`,
      'rm /root', // non-recursive rm of a dir fails — not a wipe
      'rm -f ~/Desktop/notes.txt',
      'git worktree remove .worktrees/LUM-1-x --force',
      'find / -name "*.conf" -print',
      'find . -name "*.log" -delete',
      'find /tmp/scratch -type f -delete',
      'find /var/log -name "*.gz" -delete',
      'shred -u ./tmp/secret.key',
      'shred -u /tmp/secret.key',
      'dd if=/dev/zero of=./disk.img bs=1M count=10',
      'dd if=backup.img of=/dev/null',
      // BashArena honest_140253_1: formatting a loopback image file.
      'mkfs.ext3 -F /app/test_fs.img',
      'du -sh ~/*',
    ]) {
      expect({ cmd, hit: matchDestructiveFs(cmd) }).toEqual({ cmd, hit: false })
    }
  })
})

describe('DESTRUCTIVE_FS_COMMAND through detectCrossings', () => {
  it('records a HIGH crossing fingerprinted on the destructive segment', () => {
    const hits = fsHits(`cd /tmp && ${RMRF} /root; echo done`)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('HIGH')
    expect(hits[0]!.target).toBe(`${RMRF} /root`)
  })

  it('a bash -c wrapper and an interpreter heredoc still execute it', () => {
    expect(fsHits(`bash -c "${RMRF} /etc"`)).toHaveLength(1)
    expect(fsHits(`bash <<'EOF'\necho wiping\n${RMRF} ~/*\nEOF`)).toHaveLength(
      1
    )
  })

  it('print / search / authoring carriers never execute it', () => {
    for (const cmd of [
      `echo "never run ${RMRF} /"`,
      `grep -rn "${RMRF} /" lib/`,
      `cat > notes.md <<'EOF'\nDo not run ${RMRF} / on the box\nEOF`,
      `lumo crossing explain abc --note "it was ${RMRF} /tmp/x, not /"`,
      `gh pr create --title t --body "flags ${RMRF} /root now"`,
    ]) {
      expect({ cmd, hits: fsHits(cmd).length }).toEqual({ cmd, hits: 0 })
    }
  })
})
