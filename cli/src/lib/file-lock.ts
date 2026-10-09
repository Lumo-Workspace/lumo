import * as fs from 'fs'
import * as path from 'path'

/**
 * Take an exclusive lock file; false when another process holds a lock newer
 * than `staleMs` (an older one is treated as abandoned and replaced).
 */
export function acquireFileLock(lockPath: string, staleMs: number): boolean {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'))
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs < staleMs) return false
        fs.rmSync(lockPath, { force: true })
      } catch {
        return false
      }
    }
  }
  return false
}

export function releaseFileLock(lockPath: string): void {
  fs.rmSync(lockPath, { force: true })
}
