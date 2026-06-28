import { useState, useCallback } from 'react'

export function useToast() {
  const [toast, setToast] = useState(null) // { message, type: 'error'|'success' }

  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  return { toast, showToast }
}
