import { Sandbox } from '@e2b/code-interpreter'

/**
 * Check whether an E2B sandbox is still alive by attempting to connect.
 * Returns false on any error (not found, timeout, etc.).
 */
export async function isSandboxAlive(sandboxId: string): Promise<boolean> {
  if (!sandboxId) return false

  try {
    await Sandbox.connect(sandboxId, { timeoutMs: 5000 })
    return true
  } catch {
    return false
  }
}
