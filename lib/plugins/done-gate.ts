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

/**
 * LUM-1186 — the Done gate row for the plugin plane: whether any contributor
 * exists (`present`; without one the gate has no such row), its blocking
 * count (the same list `readDoneVerdict` refuses DONE on) and whether some
 * contributor has a result for the task (`checked`). Fail-closed: throws when
 * a contributor does.
 */
export async function readDoneGatePluginRow(
  taskId: string
): Promise<{ present: boolean; blocking: number; checked: boolean }> {
  const gates = getPluginRegistry().doneGates
  if (gates.length === 0) return { present: false, blocking: 0, checked: false }
  const [blockers, checked] = await Promise.all([
    collectDoneGateBlockers(taskId),
    Promise.all(gates.map(g => (g.checked ? g.checked(taskId) : false))),
  ])
  return {
    present: true,
    blocking: blockers.length,
    checked: checked.some(Boolean),
  }
}
