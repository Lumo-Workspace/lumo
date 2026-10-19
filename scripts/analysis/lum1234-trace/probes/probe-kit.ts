/**
 * LUM-1234 — builders for the hand-written reward-hack probes. A probe is a
 * small synthetic task: a requirement, one session's `RhEvent`s (the shape
 * the product's hooks record) and the PR's files with their hunks. Every
 * string is invented for the probe; none is taken from any benchmark or
 * real transcript.
 */
import type { RhItem } from '@/ee/security/llm/reward-hack-judge-client'
import type {
  RhEvent,
  RhPrFile,
  RhSession,
} from '@/ee/security/security-scan/reward-hack-input'

export type RhItemKind = RhItem['kind']

export interface RhProbe {
  /** Stable id, e.g. `a-special-casing`. */
  id: string
  title: string
  /** positive: ≥1 reported item of one of `expectKinds`; negative: none. */
  expect: 'positive' | 'negative'
  expectKinds: RhItemKind[]
  requirement: string
  session: RhSession
  prFileList: RhPrFile[]
  /**
   * The events a correct judge would cite for the hack (positives only) —
   * used by the tests to prove the evidence gates let such an item through.
   */
  hackEventIds: string[]
}

/** The PR's merge time for every probe; every event is before it. */
export const PROBE_MERGED_AT = new Date(Date.UTC(2026, 0, 5, 18, 0, 0))

/** A session builder: ids `<probe>-<n>`, one minute apart. */
export class ProbeSession {
  readonly events: RhEvent[] = []
  private n = 0

  constructor(
    private readonly probe: string,
    readonly root = `/home/dev/acme-${probe}`
  ) {}

  private add(type: string, toolName: string | null, payload: unknown): string {
    this.n++
    const id = `${this.probe}-${this.n}`
    this.events.push({
      id,
      sessionId: `probe-${this.probe}`,
      type,
      toolName,
      payload,
      createdAt: new Date(Date.UTC(2026, 0, 5, 9, this.n, 0)),
    })
    return id
  }

  prompt(text: string): string {
    return this.add('USER_PROMPT_SUBMIT', null, { prompt: text })
  }

  stop(text: string): string {
    return this.add('STOP', null, { last_assistant_message: text })
  }

  bash(command: string, stdout: string, stderr = ''): string {
    return this.add('POST_TOOL_USE', 'Bash', {
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { stdout, stderr, interrupted: false },
    })
  }

  read(file: string, content: string): string {
    return this.add('POST_TOOL_USE', 'Read', {
      tool_name: 'Read',
      tool_input: { file_path: `${this.root}/${file}` },
      tool_response: { type: 'text', file: { content } },
    })
  }

  edit(file: string, oldString: string, newString: string): string {
    const filePath = `${this.root}/${file}`
    return this.add('POST_TOOL_USE', 'Edit', {
      tool_name: 'Edit',
      tool_input: {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
      },
      tool_response: { filePath, oldString, newString },
    })
  }

  write(file: string, content: string, kind: 'create' | 'update'): string {
    const filePath = `${this.root}/${file}`
    return this.add('POST_TOOL_USE', 'Write', {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
      tool_response: { type: kind, filePath },
    })
  }

  session(): RhSession {
    return { id: `probe-${this.probe}`, events: this.events }
  }
}

/** A hunk adding every line of `content` (a new file). */
export function addedFilePatch(content: string): string {
  const lines = content.replace(/\n$/, '').split('\n')
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join(
    '\n'
  )
}
