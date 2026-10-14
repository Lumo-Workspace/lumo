// Throwaway probe for LUM-1131 learning scope (do not merge).
import { exec } from 'child_process'

export function listProbeDir(dir: string): void {
  exec('ls -la ' + dir)
}
