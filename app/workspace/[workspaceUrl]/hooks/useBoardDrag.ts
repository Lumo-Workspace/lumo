'use client'

import { useState, useRef, useCallback, Dispatch, SetStateAction } from 'react'
import { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import { toast } from 'sonner'
import { API_STATUS_LABEL } from '../utils'
import { API } from '../constants'
import { apiFetch } from '../utils'

const API_STATUSES = Object.keys(API_STATUS_LABEL)

interface UseBoardDragOptions<
  T extends { id: string; status: string; viewOrder: number | null },
> {
  tasks: T[]
  setTasks: Dispatch<SetStateAction<T[]>>
  /** The kanban View id used to persist ordering via ViewTaskOrder. Optional — order persistence is skipped if not yet loaded. */
  viewId?: string | null
  /** Called after a successful status PATCH so callers can sync derived state (e.g. inProgressCount). */
  onStatusChanged?: (
    taskId: string,
    oldStatus: string,
    newStatus: string
  ) => void
}

/** Fractional indexing: calculate the order value for a card dropped at newIdx in a sorted column. */
function calcOrder<T extends { id: string; viewOrder: number | null }>(
  col: T[],
  newIdx: number,
  activeId: string
): number {
  const others = col.filter(t => t.id !== activeId)
  const prev = others[newIdx - 1]?.viewOrder ?? null
  const next = others[newIdx]?.viewOrder ?? null
  if (prev === null && next === null) return 0
  if (prev === null) return (next as number) - 1
  if (next === null) return (prev as number) + 1
  return ((prev as number) + (next as number)) / 2
}

export function useBoardDrag<
  T extends { id: string; status: string; viewOrder: number | null },
>({ tasks, setTasks, viewId, onStatusChanged }: UseBoardDragOptions<T>) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const dragStartStatusRef = useRef<string | null>(null)
  // Tracks the status the card is currently hovering over (updated live in onDragOver)
  const currentDragStatusRef = useRef<string | null>(null)

  const onDragStart = useCallback(
    (event: { active: { id: string | number } }) => {
      const id = String(event.active.id)
      setActiveId(id)
      const status = tasks.find(t => t.id === id)?.status ?? null
      dragStartStatusRef.current = status
      currentDragStatusRef.current = status
    },
    [tasks]
  )

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over) return
      const activeTaskId = String(active.id)
      const overId = String(over.id)
      const activeTask = tasks.find(t => t.id === activeTaskId)
      if (!activeTask) return
      const targetStatus = API_STATUSES.includes(overId)
        ? overId
        : (tasks.find(t => t.id === overId)?.status ?? null)
      if (targetStatus && activeTask.status !== targetStatus) {
        currentDragStatusRef.current = targetStatus
        setTasks(prev =>
          prev.map(t =>
            t.id === activeTaskId ? { ...t, status: targetStatus } : t
          )
        )
      }
    },
    [tasks, setTasks]
  )

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const id = String(event.active.id)
      const overId = event.over ? String(event.over.id) : null
      const originalStatus = dragStartStatusRef.current
      const newStatus = currentDragStatusRef.current
      const task = tasks.find(t => t.id === id)

      setActiveId(null)
      dragStartStatusRef.current = null
      currentDragStatusRef.current = null

      if (!task || !originalStatus || !newStatus) return

      const isSameColumn = originalStatus === newStatus

      if (isSameColumn) {
        // ── Same-column reorder ──────────────────────────────────────────────
        if (!overId || overId === id || !viewId) return

        const col = [...tasks]
          .filter(t => t.status === task.status)
          .sort((a, b) => (a.viewOrder ?? 0) - (b.viewOrder ?? 0))

        const oldIdx = col.findIndex(t => t.id === id)
        // Dropped on column container → move to end; dropped on a task → that index
        const newIdx = API_STATUSES.includes(overId)
          ? col.length - 1
          : col.findIndex(t => t.id === overId)

        if (newIdx === -1 || oldIdx === newIdx) return

        const newOrder = calcOrder(col, newIdx, id)
        const prevTasks = tasks

        // Optimistic update
        setTasks(prev =>
          prev.map(t => (t.id === id ? { ...t, viewOrder: newOrder } : t))
        )

        try {
          const res = await apiFetch(API.views.taskOrders(viewId), {
            method: 'PATCH',
            body: {
              taskId: id,
              groupKey: task.status,
              order: newOrder,
            },
          })
          if (!res.ok) throw new Error('Failed to update order')
        } catch {
          setTasks(prevTasks)
          toast.error('Failed to reorder task')
        }
      } else {
        // ── Cross-column status change ───────────────────────────────────────
        // tasks already has the moved task's status set to newStatus (from onDragOver).
        // Find newIdx relative to the column *without* the active task — calcOrder filters
        // it out internally anyway, so using the full col causes an off-by-one when the
        // active task's viewOrder places it before the drop target.
        const targetColOthers = [...tasks]
          .filter(t => t.status === newStatus && t.id !== id)
          .sort((a, b) => (a.viewOrder ?? 0) - (b.viewOrder ?? 0))

        let newOrder: number
        if (!overId || API_STATUSES.includes(overId) || overId === id) {
          // Dropped on column container → append to end
          const maxOrder = targetColOthers.reduce(
            (m, t) => Math.max(m, t.viewOrder ?? 0),
            0
          )
          newOrder = maxOrder + 1
        } else {
          // Dropped on a specific card → insert at that position.
          // Normalize null viewOrders to index*1000 so calcOrder doesn't return 0
          // when both neighbours are null (causing unstable sort).
          const normOthers = targetColOthers.map((t, i) => ({
            viewOrder: t.viewOrder ?? i * 1000,
          }))
          const insertAt = targetColOthers.findIndex(t => t.id === overId)
          const safeIdx = insertAt === -1 ? normOthers.length : insertAt
          const prev = normOthers[safeIdx - 1]?.viewOrder ?? null
          const next = normOthers[safeIdx]?.viewOrder ?? null
          if (prev === null && next === null) newOrder = 0
          else if (prev === null) newOrder = (next as number) - 1
          else if (next === null) newOrder = (prev as number) + 1
          else newOrder = ((prev as number) + (next as number)) / 2
        }

        const prevTasks = tasks

        // Optimistic: apply viewOrder immediately (status was already applied in onDragOver)
        setTasks(prev =>
          prev.map(t => (t.id === id ? { ...t, viewOrder: newOrder } : t))
        )

        try {
          const requests: Promise<Response>[] = [
            fetch(API.tasks.byId(id), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: newStatus }),
            }),
          ]

          if (viewId) {
            requests.push(
              fetch(API.views.taskOrders(viewId), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  taskId: id,
                  groupKey: newStatus,
                  order: newOrder,
                }),
              })
            )
          }

          const results = await Promise.all(requests)
          if (!results[0]?.ok) {
            const errText = await results[0]?.text()
            console.error(
              '[useBoardDrag] PATCH failed:',
              results[0]?.status,
              errText
            )
            throw new Error('Failed to update task')
          }

          onStatusChanged?.(id, originalStatus, newStatus)
        } catch (err) {
          console.error('[useBoardDrag] cross-column error, rolling back:', err)
          // Rollback both status and viewOrder
          setTasks(
            prevTasks.map(t =>
              t.id === id ? { ...t, status: originalStatus } : t
            )
          )
          toast.error('Failed to move task')
        }
      }
    },
    [tasks, setTasks, viewId, onStatusChanged]
  )

  return { activeId, onDragStart, onDragOver, onDragEnd }
}
