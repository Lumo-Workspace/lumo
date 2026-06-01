export interface WrapRunOpts {
  /** Auto-confirm: post the drafted content without prompting (agent-friendly). */
  yes: boolean
  /** Print the draft but never post or mutate server state. */
  dryRun: boolean
}

/**
 * One pane of the session wrap-up panel. Each section owns its own draft state
 * internally: `prepare()` gathers data and reports whether there's anything to
 * show; `run()` renders the preview and handles the y/e/s confirmation. This is
 * the seam LUM-152's memory-review section plugs into — same interface, no
 * runner changes.
 */
export interface WrapSection {
  title: string
  /** Gather data. Return false when there's nothing to show (runner skips run()). */
  prepare(): Promise<boolean>
  /** Render preview + handle confirmation. Only called when prepare() returned true. */
  run(opts: WrapRunOpts): Promise<void>
}

/** Run each section in order; print its title, prepare, then run if it has content. */
export async function runWrapPanel(
  sections: WrapSection[],
  opts: WrapRunOpts
): Promise<void> {
  for (const section of sections) {
    process.stdout.write(`\n━━ ${section.title} ━━\n`)
    const hasContent = await section.prepare()
    if (!hasContent) {
      process.stdout.write('(无内容)\n')
      continue
    }
    await section.run(opts)
  }
}
