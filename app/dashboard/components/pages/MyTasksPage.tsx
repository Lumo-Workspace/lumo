'use client';

import { useState } from 'react';
import { Home, LayoutGrid, Layers, ArrowRightLeft } from 'lucide-react';
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { MyTask } from '../../types';
import { API_STATUS_LABEL } from '../../utils';
import { StatusDot } from '../StatusDot';
import { PriorityBadge } from '../PriorityBadge';
import { BoardView } from '../board/BoardView';
import { MyTaskCard } from '../board/SortableTaskCard';
import { useBoardDrag } from '../../hooks/useBoardDrag';

interface MyTasksPageProps {
  tasks: MyTask[];
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
}

export function MyTasksPage({
  tasks,
  setTasks,
  loading,
  error,
  onRetry,
  onRefresh,
}: MyTasksPageProps) {
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { activeId, onDragStart, onDragOver, onDragEnd } = useBoardDrag({ tasks, setTasks });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Page header */}
      <div className="px-8 pt-6">
        <nav className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500 font-medium mb-3">
          <span className="text-zinc-900 dark:text-zinc-100">My Tasks</span>
        </nav>
      </div>
      <header className="pb-4 px-8 flex items-start justify-between shrink-0">
        <div className="flex items-start gap-4">
          <div className="size-10 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <Home size={20} />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">My Tasks</h2>
            <p className="text-sm text-zinc-500 mt-0.5">Tasks assigned to you across all projects.</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 px-3 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Toolbar */}
      <div className="h-12 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-8 shrink-0 bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-1">
          <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
            <LayoutGrid size={16} />
            Filter
          </button>
          <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
            <ArrowRightLeft size={16} className="rotate-90" />
            Sort
          </button>
        </div>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-zinc-400">
            Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={onRetry} className="text-xs text-zinc-500 underline">
              Retry
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-zinc-400">
            No tasks assigned to you.
          </div>
        ) : viewMode === 'list' ? (
          <TaskListTable tasks={tasks} />
        ) : (
          <BoardView
            tasks={tasks}
            sensors={sensors}
            activeId={activeId}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            renderCard={(task, isOverlay) => (
              <MyTaskCard key={task.id} task={task} isOverlay={isOverlay} />
            )}
          />
        )}
      </div>
    </div>
  );
}

// ─── TaskListTable ─────────────────────────────────────────────────────────────

function TaskListTable({ tasks }: { tasks: MyTask[] }) {
  return (
    <table className="w-full border-collapse">
      <thead className="sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10">
        <tr>
          <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 min-w-[300px]">
            Title
          </th>
          <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-40">
            Project
          </th>
          <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-32">
            Status
          </th>
          <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-24">
            Priority
          </th>
          <th className="text-right py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 pr-8">
            Updated
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {tasks.map(task => (
          <tr
            key={task.id}
            className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group"
          >
            <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 transition-colors">
                {task.title}
              </span>
            </td>
            <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-xs text-zinc-500">{task.project.name}</span>
            </td>
            <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <StatusDot status={task.status} />
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {API_STATUS_LABEL[task.status] ?? task.status}
                </span>
              </div>
            </td>
            <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
              <PriorityBadge priority={task.priority} />
            </td>
            <td className="py-2.5 px-8 text-xs text-zinc-400 text-right border-b border-zinc-200 dark:border-zinc-800 pr-8">
              {new Date(task.updatedAt).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── ViewToggle ────────────────────────────────────────────────────────────────

function ViewToggle({
  value,
  onChange,
}: {
  value: 'list' | 'board';
  onChange: (v: 'list' | 'board') => void;
}) {
  return (
    <div className="flex items-center p-1 bg-zinc-100 dark:bg-zinc-900 rounded-md">
      {(['list', 'board'] as const).map(mode => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded transition-all',
            value === mode
              ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
          )}
        >
          {mode === 'list' ? <Layers size={16} /> : <LayoutGrid size={16} />}
          {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </button>
      ))}
    </div>
  );
}
