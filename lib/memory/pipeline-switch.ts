/**
 * LUM-1314 — global kill switch for the automatic memory LLM pipeline.
 *
 * Set `MEMORY_PIPELINE_DISABLED=1` (or `true`) on the server to skip every
 * automatic memory model call, in every workspace: Layer 1 extraction (the
 * turn falls back to the summary-only call), Layer 2 consolidation, fold,
 * DONE-time curation, milestone distillation, and the task / milestone
 * memory-usage audits. Session, turn and run summaries keep running; existing
 * memories are still read and injected. Unset = normal behaviour.
 *
 * Unlike the LUM-917 per-workspace switch this is a cost control, not a
 * privacy control, so it does not touch summaries.
 */
export function isMemoryPipelineDisabled(): boolean {
  const v = process.env.MEMORY_PIPELINE_DISABLED?.trim().toLowerCase()
  return v === '1' || v === 'true'
}
