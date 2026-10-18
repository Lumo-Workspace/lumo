import { Command } from 'commander'

/**
 * LUM-1233 batch 4 (CX-1): how a command behaves in Codex's no-network
 * sandbox, declared where the command is defined. `emit-grammar` writes it
 * into grammar.json (and refuses to emit when a leaf has none), and the Codex
 * rules are generated from that — there is no hand-kept list.
 *
 * - `serverOnly`: the command only talks to the Lumo API (reading Lumo's own
 *   config/credentials and read-only git). Only these run outside the sandbox
 *   without a prompt.
 * - `localFiles`: `none`, `reads` (an arbitrary local file the caller names,
 *   sent to the API — `detail` names the flag), or `writes` (writes or deletes
 *   local files, or starts local processes — `detail` says what).
 *
 * A server-only command never touches local files; every other command
 * says why it stays sandboxed (`detail`).
 */
export type CodexClass =
  | { serverOnly: true; localFiles: 'none' }
  | {
      serverOnly: false
      localFiles: 'none' | 'reads' | 'writes'
      detail: string
    }

/** Only calls the Lumo API: runs outside Codex's sandbox without a prompt. */
export const SERVER_ONLY: CodexClass = { serverOnly: true, localFiles: 'none' }

/** Reads an arbitrary local file and sends it to the API (via `flag`). */
export function readsLocalFile(flag: string): CodexClass {
  return { serverOnly: false, localFiles: 'reads', detail: flag }
}

/** Writes or deletes local files, or starts local processes. */
export function writesLocal(what: string): CodexClass {
  return { serverOnly: false, localFiles: 'writes', detail: what }
}

/** Touches no arbitrary local file, but still stays sandboxed (`why`). */
export function sandboxed(why: string): CodexClass {
  return { serverOnly: false, localFiles: 'none', detail: why }
}

/**
 * A commander Command that carries its {@link CodexClass}. Subcommands made
 * with `.command()` are LumoCommands too, so `.codex()` chains anywhere. A
 * class on a group covers every command below it.
 */
export class LumoCommand extends Command {
  codexClass: CodexClass | undefined

  codex(c: CodexClass): this {
    this.codexClass = c
    return this
  }

  override createCommand(name?: string): LumoCommand {
    return new LumoCommand(name)
  }
}
