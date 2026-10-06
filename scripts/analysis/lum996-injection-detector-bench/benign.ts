/**
 * LUM-996 — the Lumo-shaped benign corpus.
 *
 * The FPR number only means something on text that looks like what Lumo
 * actually injects: READMEs and docs, PR-description-like prose, Chinese
 * text. All of it is read from THIS repository at one pinned commit through
 * `git show`, so the corpus is identical on every machine and every re-run —
 * no production data, nothing fetched.
 *
 *  - lumo-markdown         every tracked `.md` (except the vendored third-party
 *                          agent skills under `.agents/`), split at headings
 *                          into ≤ 4,000-char chunks — the size of a doc section
 *                          or a linked page excerpt.
 *  - lumo-commit-messages  every non-merge commit body. Lumo squash-merges, so
 *                          these are the PR title + description.
 *  - lumo-ui-strings       the en / zh-CN locale values, ten per sample.
 *
 * Slack threads are a gap: there is no non-production source of them.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { Sample } from './sources'

/** origin/main when LUM-996 started — the same commit the brief verified. */
export const BENIGN_COMMIT = 'c068a25599d5e77cc709d5d9a15d78d66985d975'

export const REPO_ROOT = join(__dirname, '..', '..', '..')

export const CHUNK_MAX_CHARS = 4000
export const CHUNK_MIN_DENSE_CHARS = 40
export const UI_STRINGS_PER_SAMPLE = 10

/** Paths left out of lumo-markdown: vendored third-party agent skill packs. */
export function isExcludedMarkdown(path: string): boolean {
  return path.startsWith('.agents/') || path.includes('node_modules/')
}

/**
 * Split markdown at heading lines (outside fenced code), then split any
 * section over `max` chars at blank lines. Chunks with fewer than
 * CHUNK_MIN_DENSE_CHARS non-space characters are dropped.
 */
export function chunkMarkdown(md: string, max = CHUNK_MAX_CHARS): string[] {
  const sections: string[] = []
  let current: string[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence && /^#{1,6}\s/.test(line) && current.length > 0) {
      sections.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) sections.push(current.join('\n'))

  const out: string[] = []
  for (const section of sections) {
    if (section.length <= max) {
      out.push(section)
      continue
    }
    let buf = ''
    for (const para of section.split(/\n\s*\n/)) {
      const next = buf ? `${buf}\n\n${para}` : para
      if (next.length > max && buf) {
        out.push(buf)
        buf = para
      } else buf = next
      while (buf.length > max) {
        out.push(buf.slice(0, max))
        buf = buf.slice(max)
      }
    }
    if (buf) out.push(buf)
  }
  return out.filter(c => c.replace(/\s+/g, '').length >= CHUNK_MIN_DENSE_CHARS)
}

/** Group locale values (key order) into samples of `per` lines each. */
export function chunkUiStrings(
  messages: Record<string, unknown>,
  per = UI_STRINGS_PER_SAMPLE
): string[] {
  const values = Object.keys(messages)
    .sort()
    .map(k => messages[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  const out: string[] = []
  for (let i = 0; i < values.length; i += per)
    out.push(values.slice(i, i + per).join('\n'))
  return out
}

/** Split `git log --format=%H%x1f%B%x1e` output into [sha, body] pairs. */
export function parseCommitLog(raw: string): Array<[string, string]> {
  return raw
    .split('\u001e')
    .map(r => r.replace(/^\n+/, ''))
    .filter(r => r.includes('\u001f'))
    .map(r => {
      const [sha, body] = r.split('\u001f') as [string, string]
      return [sha.trim(), body.trim()] as [string, string]
    })
    .filter(([, body]) => body !== '')
}

function git(args: string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

export function loadBenignCorpus(commit = BENIGN_COMMIT): Sample[] {
  const samples: Sample[] = []

  // -z: NUL-delimited, so non-ASCII paths are not C-quoted and dropped.
  const paths = git(['ls-tree', '-r', '-z', '--name-only', commit])
    .split('\u0000')
    .filter(p => p.endsWith('.md') && !isExcludedMarkdown(p))
    .sort()
  for (const path of paths) {
    chunkMarkdown(git(['show', `${commit}:${path}`])).forEach((text, i) =>
      samples.push({
        dataset: 'lumo-markdown',
        ref: `${path}#${i}`,
        text,
        label: 'benign',
      })
    )
  }

  for (const [sha, body] of parseCommitLog(
    git(['log', commit, '--no-merges', '--format=%H%x1f%B%x1e'])
  )) {
    samples.push({
      dataset: 'lumo-commit-messages',
      ref: sha.slice(0, 12),
      text: body,
      label: 'benign',
    })
  }

  for (const locale of ['en', 'zh-CN']) {
    const messages = JSON.parse(
      git(['show', `${commit}:lib/i18n/${locale}.json`])
    ) as Record<string, unknown>
    chunkUiStrings(messages).forEach((text, i) =>
      samples.push({
        dataset: 'lumo-ui-strings',
        ref: `${locale}#${i}`,
        text,
        label: 'benign',
      })
    )
  }

  return samples
}
