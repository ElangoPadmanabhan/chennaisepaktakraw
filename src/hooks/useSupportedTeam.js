import { useState, useEffect } from 'react'
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'

export function useSupportedTeam() {
  const { user } = useAuth()
  const [supportedTeam, setSupportedTeam] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load on mount
  useEffect(() => {
    if (!user) { setLoading(false); return }
    getDoc(doc(db, 'userTeams', user.uid)).then(snap => {
      if (snap.exists()) setSupportedTeam(snap.data().teamId)
      setLoading(false)
    })
  }, [user])

  const supportTeam = async (teamId) => {
    if (!user) return
    // Always switch to the new team — only 1 heart allowed at a time
    await setDoc(doc(db, 'userTeams', user.uid), { teamId, updatedAt: new Date() })
    setSupportedTeam(teamId)
  }

  return { supportedTeam, supportTeam, loading }
}
