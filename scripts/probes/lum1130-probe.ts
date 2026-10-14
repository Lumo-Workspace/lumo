// Throwaway probe for LUM-1130 request-changes workflow. Do not merge.
import { execFile } from 'child_process'

const ALLOWED = new Set(['reports', 'exports'])

export function archive(name: string): void {
  if (!ALLOWED.has(name)) throw new Error('unknown archive target')
  execFile('tar', ['czf', '/tmp/out.tgz', '--', name], () => undefined)
}
