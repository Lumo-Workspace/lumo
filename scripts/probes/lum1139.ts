// LUM-1139 probe (do not merge)
import { exec } from 'child_process'
export function listProbe(dir: string): void {
  exec('ls ' + dir)
}
