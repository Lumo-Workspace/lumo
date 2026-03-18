'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { MyTask } from '../types';
import { readCache, writeCache } from '../cache';

export function useMyTasks() {
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  // Hydrate from localStorage on mount so data shows immediately on refresh
  useEffect(() => {
    const cached = readCache<MyTask[]>('lumo:myTasks');
    if (cached) {
      setMyTasks(cached);
      seeded.current = true;
    }
  }, []);

  const fetchMyTasks = useCallback(async () => {
    if (!seeded.current) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/me');
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = (await res.json()) as { tasks: MyTask[] };
      setMyTasks(data.tasks);
      writeCache('lumo:myTasks', data.tasks);
      seeded.current = true;
    } catch {
      if (!seeded.current) setError('Could not load your tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { myTasks, setMyTasks, loading, error, fetchMyTasks };
}
