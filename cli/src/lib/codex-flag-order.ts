import { CODEX_CLASSES } from './codex-classes.generated'

/**
 * LUM-1292: Codex's rules match a command's leading tokens, so a flag placed
 * before the command words (`lumo --no-hints init`) hides the command from
 * every `prompt` rule and only the catch-all `allow` for `["lumo"]` matches.
 * The CLI therefore refuses that ordering for every command whose Codex class
 * is not server-only; server-only commands keep free flag order.
 */

/** Whether the Codex class of `commandPath` (own or a group's) is server-only. */
export function isServerOnlyPath(commandPath: string): boolean {
  const words = commandPath.split(' ')
  for (let n = words.length; n > 0; n--) {
    const cls = CODEX_CLASSES[words.slice(0, n).join(' ')]
    if (cls) return cls.serverOnly
  }
  return false
}

/**
 * True when a `-…` token appears before the last word of `commandPath` in
 * `argv` (the arguments after `lumo`). The command words are matched in order,
 * skipping everything else (`--` counts as a flag), so a flag's value never counts as a command word
 * unless it spells one (which can only make the check stricter).
 */
export function flagsBeforeCommandWords(
  argv: readonly string[],
  commandPath: string
): boolean {
  const words = commandPath.split(' ').filter(Boolean)
  let next = 0
  let sawFlag = false
  for (const tok of argv) {
    // `--` is swallowed by the parser and the operands after it still reach
    // the subcommand, so while command words are unmatched it counts as a flag.
    if (tok === '--') {
      if (next < words.length) sawFlag = true
      continue
    }
    if (next < words.length && tok === words[next]) {
      next++
      if (next === words.length) return sawFlag
    } else if (tok.startsWith('-')) sawFlag = true
  }
  // Fail closed: the command words were not all found in argv.
  return true
}

/** The `Error:` / `Hint:` lines to print, or null when the order is fine. */
export function codexFlagOrderError(
  argv: readonly string[],
  commandPath: string
): string[] | null {
  if (isServerOnlyPath(commandPath)) return null
  if (!flagsBeforeCommandWords(argv, commandPath)) return null
  const words = commandPath.split(' ')
  const flags: string[] = []
  const rest: string[] = []
  let next = 0
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!
    if (next < words.length && tok === words[next]) {
      next++
      continue
    }
    if (next < words.length) {
      // before the last command word: a global flag (and maybe its value)
      flags.push(tok)
    } else rest.push(tok)
  }
  const reordered = ['lumo', ...words, ...rest, ...flags].join(' ')
  return [
    `Error: global flags before the command words are not accepted for \`lumo ${commandPath}\` (it writes local files, reads local files or is a human-only ruling, and Codex's rules only recognise it when the command words come first).`,
    `Hint: put the global flags after the command words, e.g. \`${reordered}\`.`,
  ]
}
