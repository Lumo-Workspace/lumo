// Throwaway probe for LUM-1133 (draft PR, no Lumo task). Do not merge.
import { exec } from 'child_process'

export function listDir(dir: string): void {
  exec('ls ' + dir)
}
