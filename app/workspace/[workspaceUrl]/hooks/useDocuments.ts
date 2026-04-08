'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiDocument } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { documentsClient } from '@/lib/api-client'

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
      const data = await documentsClient.list<{ documents: ApiDocument[] }>(
        visibility
      )
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
