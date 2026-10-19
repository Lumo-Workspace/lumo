/**
 * LUM-788 — the per-task hunt read-out, shared by the CLI (`lumo pr show
 * --full`) and the lum739 analysis script. One implementation: the CLI is a
 * separate package that cannot import `lib/` or `scripts/`, and a second copy
 * of this printer is exactly how the audit lost four fields to "computed,
 * carried, never read" before LUM-758.
 *
 * Pure formatting over the raw `PrSecurityScan.huntAudit.tasks[]` rows. Every
 * field is optional by construction: the column is Json written by past
 * versions of the workflow, and a row written before a field existed prints
 * exactly as it always did — nothing is guessed, nothing is thrown over.
 */

/** One task row's audit facts, as the read-out prints them. */
export interface ShellDetailTask {
  taskId?: unknown
  stopped?: unknown
  /** LUM-787 — the model the search ran on; absent on older rows. */
  model?: string
  /** LUM-787 follow-up — sites the task had to cover (its allocation weight). */
  sites?: number
  shell?: {
    notFound?: number
    calls?: number
    refused?: number
    failed?: number
    empty?: number
    /** LUM-787 — absent on rows written before the per-step ceiling existed, and when nothing was clipped. */
    stepClipped?: number
    /** LUM-799 — commands this task had already run once; absent when none was. */
    repeated?: number
    commands?: {
      cmd?: string
      denied?: boolean
      reason?: string
      chars?: number
      compressed?: boolean
      /** LUM-787 — cut by the per-step ceiling. */
      clipped?: boolean
    }[]
  }
  /** LUM-781 — absent on rows written before the trace existed. */
  trace?: {
    i?: number
    tool?: string
    text?: string
    inputTokens?: number
    /** LUM-1224 — the part of `inputTokens` read from the prompt cache. */
    cacheReadTokens?: number
    /** LUM-1224 — the part of `inputTokens` written to the prompt cache. */
    cacheWriteTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    finishReason?: string
    /** LUM-787 — characters of older results elided from what this step was sent. */
    elidedChars?: number
  }[]
  stop?: {
    by?: string
    spent?: number
    budget?: number
    reserve?: number
    lastStep?: number
    /** LUM-787 — the price the next step was charged at. */
    next?: number
    steps?: number
    /** LUM-799 — trailing steps that asked only for already-issued commands. */
    repeatSteps?: number
  }
  wrapUp?: {
    ran?: boolean
    skipped?: string
    submitted?: number
    text?: string
    tokens?: number
    finishReason?: string
    error?: string
  }
  /** LUM-1226 — what `submit_candidates` was sent and kept; absent on older rows. */
  submission?: HuntSubmissionReadout
}

/**
 * LUM-1226 — a task's candidate submission as the read-out carries it: counts
 * and the schema field names the dropped candidates failed on. Never free text.
 */
export interface HuntSubmissionReadout {
  calls?: number
  submitted?: number
  kept?: number
  dropped?: number
  reasons?: string[]
}

const SUBMISSION_COUNTS = ['calls', 'submitted', 'kept', 'dropped'] as const
/** A schema field path (`cwe`, `call_chain.from`) or `limit` — nothing else passes. */
const SUBMISSION_REASON = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/
const SUBMISSION_REASON_MAX_CHARS = 64
const SUBMISSION_REASONS_MAX = 16

/**
 * LUM-1226 — the `submission` object off a raw `huntAudit.tasks[]` row, kept
 * to finite non-negative counts and field-name-shaped reasons. Undefined when
 * the row has none (written before the field existed) or no count survives.
 * Shared by the scan read-out and the evidence-retention scrub so both keep
 * exactly the same, code-free facts.
 */
export function readHuntSubmission(
  raw: unknown
): HuntSubmissionReadout | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return undefined
  const r = raw as Record<string, unknown>
  const out: HuntSubmissionReadout = {}
  let counted = false
  for (const k of SUBMISSION_COUNTS) {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[k] = v
      counted = true
    }
  }
  if (!counted) return undefined
  if (Array.isArray(r.reasons)) {
    const reasons = r.reasons
      .filter(
        (x): x is string =>
          typeof x === 'string' &&
          x.length <= SUBMISSION_REASON_MAX_CHARS &&
          SUBMISSION_REASON.test(x)
      )
      .slice(0, SUBMISSION_REASONS_MAX)
    if (reasons.length > 0) out.reasons = reasons
  }
  return out
}

/**
 * LUM-1226 — `    candidates: submitted N · kept K · dropped D (reasons: …)`,
 * plus the call count when the tool was called more than once.
 */
function submissionLine(s: HuntSubmissionReadout): string {
  const reasons =
    s.reasons && s.reasons.length > 0
      ? ` (reasons: ${s.reasons.join(', ')})`
      : ''
  const calls =
    typeof s.calls === 'number' && s.calls > 1 ? ` · ${s.calls} calls` : ''
  return `    candidates: submitted ${s.submitted ?? '?'} · kept ${s.kept ?? '?'} · dropped ${s.dropped ?? '?'}${reasons}${calls}`
}

/** One line of prose, flattened, for a fixed-width read-out. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * LUM-1224 — one task's prompt-cache totals over its trace steps:
 * `    cache: read N / write M of X input`. Null when no step carries either
 * counter (a row from before they existed, or a provider that reports
 * none), so such a task prints exactly as before. A reported zero still
 * prints: "under the cache minimum" and "not measured" must not read alike.
 */
function traceCacheLine(
  trace: NonNullable<ShellDetailTask['trace']>
): string | null {
  let seen = false
  let read = 0
  let write = 0
  let input = 0
  for (const st of trace) {
    input += st.inputTokens ?? 0
    if (typeof st.cacheReadTokens === 'number') {
      seen = true
      read += st.cacheReadTokens
    }
    if (typeof st.cacheWriteTokens === 'number') {
      seen = true
      write += st.cacheWriteTokens
    }
  }
  return seen
    ? `    cache: read ${read} / write ${write} of ${input} input`
    : null
}

/**
 * The per-task listing for EVERY task handed in, idle ones included — the
 * `lumo pr show --full` shape. A task that never asked the shell for anything
 * still has a stop line, a model and the sites it was briefed on, and "this
 * task ran two steps and submitted nothing" is a fact the reader came for.
 *
 * Lines per task: a header (`t1 done · <model> · 3 sites · 2 cmds (gate
 * refused …)`), one line per command (`✗` = the gate refused it, with its
 * reason), one line per trace step, the task's prompt-cache totals
 * (LUM-1224), the stop arithmetic, the wrap-up outcome, then the candidate
 * submission counts (LUM-1226) — each only when the row carries it.
 */
export function formatHuntTaskDetail(
  tasks: ShellDetailTask[],
  maxTasks: number
): string[] {
  const out: string[] = []
  for (const t of tasks.slice(0, maxTasks)) {
    const sh = t.shell
    // LUM-787 — the model and the sites print only when the row carries them;
    // the clip count likewise: an older row, and a row from a search that
    // never hit the ceiling, read as before.
    const cmds = sh?.calls
      ? `${sh.calls} cmds (gate refused ${sh.refused ?? 0}, sandbox failed ${sh.failed ?? 0}, not found ${sh.notFound ?? 0}, empty ${sh.empty ?? 0}${sh.stepClipped ? `, step-clipped ${sh.stepClipped}` : ''}${sh.repeated ? `, repeated ${sh.repeated}` : ''})`
      : 'no shell commands'
    out.push(
      `${String(t.taskId)} ${String(t.stopped)}${t.model ? ` · ${t.model}` : ''}${typeof t.sites === 'number' ? ` · ${t.sites} sites` : ''} · ${cmds}`
    )
    for (const c of sh?.commands ?? []) {
      const cost =
        typeof c.chars === 'number'
          ? `  [${c.chars} chars${c.compressed ? ', compressed' : ''}${c.clipped ? ', clipped' : ''}]`
          : ''
      out.push(
        `    ${c.denied ? '✗' : ' '} ${c.cmd ?? ''}${cost}${c.reason ? `   ← ${c.reason}` : ''}`
      )
    }
    // LUM-781 — the model's side, step by step, then how it ended. Only when
    // the row carries them: an older row prints exactly as before.
    for (const st of t.trace ?? []) {
      out.push(
        `    #${st.i ?? '?'} tool=${st.tool ?? '(none)'} in=${st.inputTokens ?? '?'} out=${st.outputTokens ?? '?'}${st.reasoningTokens ? ` reasoning=${st.reasoningTokens}` : ''}${st.elidedChars ? ` elided=${st.elidedChars}` : ''}${st.finishReason ? ` finish=${st.finishReason}` : ''}${st.text ? ` "${oneLine(st.text, 160)}"` : ''}`
      )
    }
    const cache = traceCacheLine(t.trace ?? [])
    if (cache) out.push(cache)
    if (t.stop) {
      const s = t.stop
      out.push(
        `    stop: ${s.by ?? '?'} · spent ${s.spent ?? '?'}/${s.budget ?? '?'} · reserve ${s.reserve ?? 0} · last step ${s.lastStep ?? '?'}${typeof s.next === 'number' ? ` · next ${s.next}` : ''} · ${s.steps ?? '?'} steps${s.repeatSteps ? ` · ${s.repeatSteps} repeat steps` : ''}`
      )
    }
    if (t.wrapUp) {
      const w = t.wrapUp
      out.push(
        w.ran
          ? `    wrap-up: ran · submitted ${w.submitted ?? 0} · ${w.tokens ?? '?'} tokens${w.finishReason ? ` · finish=${w.finishReason}` : ''}${w.text ? ` · "${oneLine(w.text, 200)}"` : ''}`
          : w.error
            ? `    wrap-up: attempted, failed — ${oneLine(w.error, 160)}`
            : `    wrap-up: not made (${w.skipped ?? 'unknown'})`
      )
    }
    if (t.submission) out.push(submissionLine(t.submission))
  }
  return out
}

/**
 * The per-task, command-by-command listing of the lum739 audit report —
 * only tasks that actually asked the shell for something.
 *
 * The run-level `shell:` line says HOW MUCH; only this says WHAT — and telling
 * "mapped the repo and ran out" from "the gate rejected everything" from
 * "looked and found nothing" is the entire reason the field exists. Extracted
 * as a pure function so it can be tested: a read-out nothing exercises is the
 * same "computed, carried, never read" shape this layer has already lost four
 * fields to.
 */
export function formatShellDetail(
  tasks: ShellDetailTask[],
  maxTasks: number
): string[] {
  return formatHuntTaskDetail(
    tasks.filter(x => x.shell?.calls),
    maxTasks
  )
}
