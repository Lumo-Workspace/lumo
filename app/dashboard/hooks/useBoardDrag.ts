'use client';

import { useState, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import { DragEndEvent, DragOverEvent } from '@dnd-kit/core';

const API_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'];

interface UseBoardDragOptions<T extends { id: string; status: string }> {
  tasks: T[];
  setTasks: Dispatch<SetStateAction<T[]>>;
  /** Called after a successful PATCH so callers can sync derived state (e.g. inProgressCount). */
  onStatusChanged?: (taskId: string, oldStatus: string, newStatus: string) => void;
}

export function useBoardDrag<T extends { id: string; status: string }>({
  tasks,
  setTasks,
  onStatusChanged,
}: UseBoardDragOptions<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragStartStatusRef = useRef<string | null>(null);

  const onDragStart = useCallback(
    (event: { active: { id: string | number } }) => {
      const id = String(event.active.id);
      setActiveId(id);
      dragStartStatusRef.current = tasks.find(t => t.id === id)?.status ?? null;
    },
    [tasks],
  );

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeTaskId = String(active.id);
      const overId = String(over.id);
      const activeTask = tasks.find(t => t.id === activeTaskId);
      if (!activeTask) return;
      const targetStatus = API_STATUSES.includes(overId)
        ? overId
        : (tasks.find(t => t.id === overId)?.status ?? null);
      if (targetStatus && activeTask.status !== targetStatus) {
        setTasks(prev =>
          prev.map(t => (t.id === activeTaskId ? { ...t, status: targetStatus } : t)),
        );
      }
    },
    [tasks, setTasks],
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      const id = String(event.active.id);
      const originalStatus = dragStartStatusRef.current;
      const task = tasks.find(t => t.id === id);
      if (!task || !originalStatus || originalStatus === task.status) return;
      const newStatus = task.status;
      try {
        const res = await fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error('Failed to update task');
        onStatusChanged?.(id, originalStatus, newStatus);
      } catch {
        // Rollback optimistic move
        setTasks(prev =>
          prev.map(t => (t.id === id ? { ...t, status: originalStatus } : t)),
        );
      }
    },
    [tasks, setTasks, onStatusChanged],
  );

  return { activeId, onDragStart, onDragOver, onDragEnd };
}
