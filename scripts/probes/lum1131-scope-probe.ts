// Throwaway probe for LUM-1131 learning scope (do not merge). Round 2.
import { exec } from 'child_process'

export function listProbeDir(dir: string): void {
  exec('ls -la ' + dir)
}
