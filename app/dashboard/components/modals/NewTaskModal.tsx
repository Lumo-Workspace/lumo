'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { Modal } from '../Modal';
import { ApiProject, ApiStatus, WorkspaceMemberInfo } from '../../types';

export interface NewTaskFormData {
  title: string;
  description: string;
  status: ApiStatus;
  projectId: string;
  assigneeId: string;
}

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ApiProject[];
  members: WorkspaceMemberInfo[];
  defaultProjectId?: string | undefined;
  /** Parent handles optimistic create + API call. Throw to show error in modal. */
  onSubmit: (data: NewTaskFormData) => Promise<void>;
}

export function NewTaskModal({
  isOpen,
  onClose,
  projects,
  members,
  defaultProjectId,
  onSubmit,
}: NewTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ApiStatus>('TODO');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync default project when it changes (e.g. user opens modal on a different project page)
  useEffect(() => {
    setProjectId(defaultProjectId ?? '');
  }, [defaultProjectId]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setStatus('TODO');
    setProjectId(defaultProjectId ?? '');
    setAssigneeId('');
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    const effectiveProjectId = projectId || defaultProjectId || '';
    if (!trimmedTitle || !effectiveProjectId) return;

    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        title: trimmedTitle,
        description,
        status,
        projectId: effectiveProjectId,
        assigneeId,
      });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = title.trim().length > 0 && (projectId || defaultProjectId);

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="New task"
        footer={
          <div className="flex items-center gap-3 ml-auto">
            {error && <p className="text-xs text-red-500 mr-auto">{error}</p>}
            <button
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating…' : 'Create task ⏎'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <input
            autoFocus
            className="w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none"
            placeholder="Task title"
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) handleSubmit();
            }}
          />
          <textarea
            className="w-full bg-transparent border-none p-0 text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 focus:ring-0 outline-none resize-none leading-relaxed min-h-[80px] font-sans"
            placeholder="Add description..."
            rows={4}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            {/* Status */}
            <select
              value={status}
              onChange={e => setStatus(e.target.value as ApiStatus)}
              className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-300"
            >
              <option value="TODO">Todo</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="DONE">Done</option>
            </select>

            {/* Project */}
            <select
              value={projectId || defaultProjectId || ''}
              onChange={e => setProjectId(e.target.value)}
              className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-300 max-w-[180px] truncate"
            >
              {projects.length === 0 && <option value="">No projects</option>}
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Assignee */}
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-300 max-w-[180px] truncate"
            >
              <option value="">Unassigned</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </AnimatePresence>
  );
}
