import { useState, useEffect, useCallback } from 'react'
import { CACHE_KEY } from '../constants'

export function useDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(CACHE_KEY.darkMode) === 'true'
    setIsDarkMode(stored)
    document.documentElement.classList.toggle('dark', stored)
  }, [])

  const toggle = useCallback(() => {
    setIsDarkMode(prev => {
      const next = !prev
      localStorage.setItem(CACHE_KEY.darkMode, String(next))
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }, [])

  return { isDarkMode, toggle }
}
