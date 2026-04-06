'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiDocument } from '../types'
import { readCache, writeCache } from '../cache'
import { API, CACHE_KEY } from '../constants'

export function useDocuments() {
  const [documents, setDocuments] = useState<ApiDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  useEffect(() => {
    const cached = readCache<ApiDocument[]>(CACHE_KEY.documents)
    if (cached) {
      setDocuments(cached)
      seeded.current = true
    }
  }, [])

  const fetchDocuments = useCallback(async (visibility?: string) => {
    if (!seeded.current) setLoading(true)
    setError(null)
    try {
      const url = visibility
        ? `${API.documents.list}?visibility=${visibility}`
        : API.documents.list
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load documents')
      const data = (await res.json()) as { documents: ApiDocument[] }
      setDocuments(data.documents)
      writeCache(CACHE_KEY.documents, data.documents)
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load documents.')
    } finally {
      setLoading(false)
    }
  }, [])

  return { documents, setDocuments, loading, error, fetchDocuments }
}
