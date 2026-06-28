import { useState, useCallback } from 'react'
import { waitForPendingWrites } from 'firebase/firestore'
import { db } from '../firebase'

export function usePendingWrites() {
  const [pending, setPending] = useState(false)

  const checkPending = useCallback(async () => {
    setPending(true)
    try {
      await waitForPendingWrites(db)
    } finally {
      setPending(false)
    }
  }, [])

  return { pending, checkPending }
}
