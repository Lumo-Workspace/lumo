'use client';

import { useState, useRef, useCallback } from 'react';
import { ApiTask } from '../types';
import { readCache, writeCache } from '../cache';
import { flattenTasks } from '../utils';

export function useProjectTasks() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  /**
   * Immediately populate state from the per-project cache key.
   * Call this before `fetchProjectTasks` when switching projects.
   */
  const hydrateForProject = useCallback((projectId: string) => {
    const cached = readCache<ApiTask[]>(`lumo:projectTasks:${projectId}`);
    if (cached) {
      setTasks(cached);
      seeded.current = true;
    } else {
      setTasks([]);
      seeded.current = false;
    }
  }, []);

  const fetchProjectTasks = useCallback(async (projectId: string) => {
    if (!seeded.current) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`);
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = (await res.json()) as {
        tasks: (ApiTask & { children?: ApiTask[] })[];
      };
      const flat = flattenTasks(data.tasks);
      setTasks(flat);
      writeCache(`lumo:projectTasks:${projectId}`, flat);
      seeded.current = true;
    } catch {
      if (!seeded.current) setError('Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { tasks, setTasks, loading, error, hydrateForProject, fetchProjectTasks };
}
