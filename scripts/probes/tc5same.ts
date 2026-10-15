// milestone TC5 probe tc5y2 (do not merge)
import { exec } from 'child_process'
export function listProbeDir(dir: string): void {
  exec('ls -la ' + dir)
}

export const ROUND2 = 2
