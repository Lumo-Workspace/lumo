'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { WorkspaceMemberInfo } from '../types';
import { readCache, writeCache } from '../cache';

export function useMembers() {
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([]);
  const seeded = useRef(false);

  useEffect(() => {
    const cached = readCache<WorkspaceMemberInfo[]>('lumo:members');
    if (cached) {
      setMembers(cached);
      seeded.current = true;
    }
  }, []);

  // Fetch once per session; subsequent calls are no-ops
  const fetchMembers = useCallback(async () => {
    if (seeded.current) return;
    try {
      const res = await fetch('/api/workspaces/members');
      if (!res.ok) return;
      const data = (await res.json()) as { members: WorkspaceMemberInfo[] };
      setMembers(data.members);
      writeCache('lumo:members', data.members);
      seeded.current = true;
    } catch {
      // Non-critical — assignee picker stays empty
    }
  }, []);

  return { members, fetchMembers };
}
