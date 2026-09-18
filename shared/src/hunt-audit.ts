/**
 * LUM-788 — the per-task hunt read-out, shared by the CLI (`lumo pr scan
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
}

/** One line of prose, flattened, for a fixed-width read-out. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * The per-task listing for EVERY task handed in, idle ones included — the
 * `lumo pr scan --full` shape. A task that never asked the shell for anything
 * still has a stop line, a model and the sites it was briefed on, and "this
 * task ran two steps and submitted nothing" is a fact the reader came for.
 *
 * Lines per task: a header (`t1 done · <model> · 3 sites · 2 cmds (gate
 * refused …)`), one line per command (`✗` = the gate refused it, with its
 * reason), one line per trace step, then the stop arithmetic and the
 * wrap-up outcome — each only when the row carries it.
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
