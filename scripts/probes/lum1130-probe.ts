// Throwaway probe for LUM-1130 request-changes workflow. Do not merge.
import { exec } from 'child_process'

export function archive(name: string): void {
  exec('tar czf /tmp/out.tgz ' + name)
}
