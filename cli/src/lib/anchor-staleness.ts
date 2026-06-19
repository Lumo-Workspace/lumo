import { execFileSync } from 'node:child_process'
import {
  classifyMemoryStaleness,
  type AnchorProbe,
  type CodeAnchor,
} from '../../../shared/src/code-anchor'

/**
 * LUM-547 (P4b) — CLI side of code-anchor staleness detection.
 *
 * The Lumo server has no checkout of the team's repo, so existence-checking can
 * only run where the repo is — here, in `lumo memory sync`, right after the team
 * memory lands locally. This module resolves anchors against git-tracked files
 * (`git ls-files`) and exact word-boundary grep (`git grep -w`), classifies each
 * synced memory, and reports stale candidates to the server. It NEVER mutates a
 * memory's status — retirement stays human-confirmed (web → ARCHIVED).
 */

export interface StaleCandidate {
  memoryId: string
  deadAnchors: CodeAnchor[]
}

export interface AnchorCheckOptions {
  dryRun?: boolean | undefined
  clean?: boolean | undefined
  /** commander `--no-anchor-check` sets this to false. */
  anchorCheck?: boolean | undefined
}

/**
 * Build an existence probe over the repo at `cwd`. Resolves against git-tracked
 * state, never the dirty working tree, so an uncommitted local rename/branch
 * cannot false-flag a team memory. Fails OPEN: if git is unavailable or the
 * lookup errors, anchors are treated as still-existing (宁可放过 — never
 * false-flag a good memory off a broken probe).
 */
export function createRepoProbe(cwd: string): AnchorProbe {
  const tracked = new Set<string>()
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
    for (const line of out.split('\n')) {
      const p = line.trim()
      if (p) tracked.add(p)
    }
  } catch {
    // not a git repo / git missing — leave `tracked` empty → fail open below.
  }
  const ready = tracked.size > 0

  return {
    fileExists: p => (ready ? tracked.has(p) : true),
    symbolExists: name => {
      if (!ready) return true
      try {
        // exit 0 = found. `-w` word-boundary, `-q` quiet, `-F` fixed string,
        // `-e` so a name starting with '-' is never read as a flag.
        execFileSync('git', ['grep', '-wqF', '-e', name], {
          cwd,
          stdio: 'ignore',
        })
        return true
      } catch (err) {
        // exit 1 = clean "no match" → absent; any other exit = probe error →
        // fail open (treat as present) so we never false-flag on a git hiccup.
        const status = (err as { status?: number }).status
        return status === 1 ? false : true
      }
    },
  }
}

/**
 * Classify each synced memory and keep only the stale candidates (every anchor
 * dead). Pure given the probe — the heavy lifting lives in
 * {@link classifyMemoryStaleness}.
 */
export function detectStaleCandidates(
  entries: { id: string; body: string }[],
  probe: AnchorProbe
): StaleCandidate[] {
  const out: StaleCandidate[] = []
  for (const e of entries) {
    const verdict = classifyMemoryStaleness(e.body, probe)
    if (verdict.stale) {
      out.push({ memoryId: e.id, deadAnchors: verdict.deadAnchors })
    }
  }
  return out
}

export interface ReportResult {
  ok: boolean
  recorded?: number | undefined
  status?: number | undefined
}

/**
 * Report stale candidates to the server's stale-anchors endpoint (bearer auth).
 * No candidates → no network call. This is the ONLY server write the detection
 * path makes; it records candidacy, never archives.
 */
export async function reportStaleCandidates(
  base: string,
  token: string,
  projectId: string,
  candidates: StaleCandidate[]
): Promise<ReportResult> {
  if (candidates.length === 0) return { ok: true, recorded: 0 }
  const res = await fetch(
    `${base}/api/projects/${encodeURIComponent(projectId)}/memories/stale-anchors`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ candidates }),
    }
  )
  if (!res.ok) return { ok: false, status: res.status }
  const data = (await res.json().catch(() => ({}))) as { recorded?: number }
  return { ok: true, recorded: data.recorded }
}

/**
 * Whether `memory sync` should run the anchor check. Skipped for an explicit
 * `--no-anchor-check`, and for `--dry-run` / `--clean` (a preview or rollback
 * must not write candidates to the server).
 */
export function shouldRunAnchorCheck(options: AnchorCheckOptions): boolean {
  if (options.anchorCheck === false) return false
  if (options.dryRun || options.clean) return false
  return true
}

/**
 * Orchestrate the check: build the repo probe, detect candidates over the synced
 * entries, and report them. Best-effort — returns the candidate count and the
 * report result; callers log and move on (never fail the sync over detection).
 */
export async function runAnchorCheck(input: {
  cwd: string
  base: string
  token: string
  projectId: string
  entries: { id: string; body: string }[]
}): Promise<{ candidates: StaleCandidate[]; report: ReportResult }> {
  const probe = createRepoProbe(input.cwd)
  const candidates = detectStaleCandidates(input.entries, probe)
  const report = await reportStaleCandidates(
    input.base,
    input.token,
    input.projectId,
    candidates
  )
  return { candidates, report }
}
