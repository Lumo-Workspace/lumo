'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiProject } from '../types'
import { readCache, writeCache } from '../cache'
import { API, CACHE_KEY } from '../constants'

export function useProjects() {
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  useEffect(() => {
    const cached = readCache<ApiProject[]>(CACHE_KEY.projects)
    if (cached) {
      setProjects(cached)
      seeded.current = true
    }
  }, [])

  const fetchProjects = useCallback(async () => {
    if (!seeded.current) setLoading(true)
    setError(null)
    try {
      const res = await fetch(API.projects.list)
      if (!res.ok) throw new Error('Failed to load projects')
      const data = (await res.json()) as { projects: ApiProject[] }
      setProjects(data.projects)
      writeCache(CACHE_KEY.projects, data.projects)
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load projects.')
    } finally {
      setLoading(false)
    }
  }, [])

  return { projects, setProjects, loading, error, fetchProjects }
}
