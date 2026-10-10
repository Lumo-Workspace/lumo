/**
 * LUM-1061 (RFC §3.4 "DONE 闸") — the DONE gate's plugin plane.
 *
 * Every registered `doneGate` contributor is asked for its open blockers;
 * the lists are concatenated in registration order. Fail-closed: a
 * contributor that throws makes this throw, exactly like the gate's other
 * blocking planes. No contributor → `[]`, so the gate decides on crossings
 * and test cases alone (it never refuses DONE because a plugin is missing).
 */
import { getPluginRegistry } from './registry'
import type { DoneBlocker } from './types'

export async function collectDoneGateBlockers(
  taskId: string
): Promise<DoneBlocker[]> {
  const gates = getPluginRegistry().doneGates
  if (gates.length === 0) return []
  const lists = await Promise.all(gates.map(g => g.openBlockers(taskId)))
  return lists.flat()
}
