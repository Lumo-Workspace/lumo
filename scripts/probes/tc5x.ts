// milestone TC5 probe tc5x (do not merge)
import { exec } from 'child_process'
export function listProbeDir(dir: string): void {
  exec('ls -la ' + dir)
}
