import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, onSnapshot, updateDoc, collection, increment, getDocs, getDoc, query } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import ViewerCount from '../components/ViewerCount'
import { useMatchPresence } from '../hooks/useMatchPresence'
import { useToast } from '../hooks/useToast'
import { useRecalcTable } from '../hooks/useRecalcTable'
import { usePendingWrites } from '../hooks/usePendingWrites'

// ── Game rules ────────────────────────────────────────────
const MAX_SETS    = 3
const WIN_PTS     = 15
const DEUCE_AT    = 14
const DEUCE_WIN   = 17
const SETS_TO_WIN = 2
const TIMEOUT_SEC = 60
// Per set per team: max 2 total changes (subs + reentries), max 1 reentry
const MAX_CHANGES = 2
const MAX_REENTRY = 1

function checkSetWinner(h, a) {
  if (h >= WIN_PTS && a < DEUCE_AT) return 'home'
  if (a >= WIN_PTS && h < DEUCE_AT) return 'away'
  if (h >= DEUCE_WIN) return 'home'
  if (a >= DEUCE_WIN) return 'away'
  return null
}
function isDeuce(h, a) { return h >= DEUCE_AT && a >= DEUCE_AT }

function emptySet() {
  return {
    home: 0, away: 0, winner: null,
    homeTimeout: false,  awayTimeout: false,
    homeSubs: 0,         awaySubs: 0,       // 0–2
    homeReentries: 0,    awayReentries: 0,  // 0–1
  }
}

// ── Style constants ───────────────────────────────────────
const ROLE_COLORS = {
  Captain:       { bg: 'rgba(255,179,0,0.12)', color: '#b45309', border: 'rgba(255,179,0,0.3)' },
  'Vice Captain':{ bg: 'rgba(99,102,241,0.1)', color: '#4338ca', border: 'rgba(99,102,241,0.25)' },
  Player:        { bg: 'var(--bg-elevated)',    color: 'var(--text-3)', border: 'var(--border)' },
}
const POS_COLORS = {
  Feeder: { bg: 'rgba(34,197,94,0.1)',  color: '#15803d', border: 'rgba(34,197,94,0.3)'  },
  Tekong: { bg: 'rgba(14,165,233,0.1)', color: '#0369a1', border: 'rgba(14,165,233,0.3)' },
  Killer: { bg: 'rgba(239,68,68,0.1)',  color: '#b91c1c', border: 'rgba(239,68,68,0.3)'  },
}
const EVENT_ICON = { Regu: '👟', Quad: '🏐' }

// ── Main component ────────────────────────────────────────
export default function Scoring() {
  const { leagueId, fixtureId } = useParams()
  const navigate  = useNavigate()
  const { isAdmin } = useAuth()

  useMatchPresence(fixtureId)

  const [fixture, setFixture]         = useState(null)
  const [homePlayers, setHomePlayers] = useState([])
  const [awayPlayers, setAwayPlayers] = useState([])
  const [loading, setLoading]         = useState(!!fixtureId)
  const [busy, setBusy]               = useState(false)
  const [confirmPending, setConfirmPending] = useState(null) // { side, winnerName, score }
  const completingRef = useRef(false)   // prevents double-tap from running stats twice
  const [timeoutState, setTimeoutState] = useState(null)
  const { toast, showToast } = useToast()
  const { recalc } = useRecalcTable()
  const { pending: syncPending, checkPending } = usePendingWrites()
  const [liveUrl, setLiveUrl]         = useState('')
  // lineup picker (before start)
  const [homeStarting, setHomeStarting] = useState([]) // playerIds selected as starting
  const [awayStarting, setAwayStarting] = useState([])
  const [showLineupPicker, setShowLineupPicker] = useState(true)
  // coin toss flow
  const [tossPhase, setTossPhase] = useState('pretoss') // 'pretoss'|'toss_call'|'toss_result'|'toss_pick'|'manual_pick'|'done'
  const [tossData, setTossData]   = useState({ callerSide: null, callerChoice: null, coinResult: null, winnerSide: null, winnerChoice: null, servingFirst: null })
  // sub/re-entry modal
  const [subModal, setSubModal] = useState(null) // { side, type: 'sub'|'reentry' }
  const [editScoresMode, setEditScoresMode] = useState(false)

  // ── Timeout countdown ─────────────────────────────────
  useEffect(() => {
    if (!timeoutState) return
    if (timeoutState.remaining <= 0) {
      setTimeoutState(null)
      // Clear from Firestore so viewers stop seeing it
      save({ timeoutActive: null })
      return
    }
    const id = setTimeout(() =>
      setTimeoutState(prev => prev ? { ...prev, remaining: prev.remaining - 1 } : null)
    , 1000)
    return () => clearTimeout(id)
  }, [timeoutState])

  // ── Fixture listener ──────────────────────────────────
  useEffect(() => {
    if (!leagueId || !fixtureId) { setLoading(false); return }
    return onSnapshot(doc(db, 'leagues', leagueId, 'fixtures', fixtureId), snap => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() }
        if (!data.sets || data.sets.length === 0) data.sets = [emptySet()]
        if (data.currentSet === undefined) data.currentSet = 0
        setFixture(data)
      }
      setLoading(false)
    })
  }, [leagueId, fixtureId])

  // ── Players listeners ─────────────────────────────────
  useEffect(() => {
    if (!leagueId || !fixture?.homeTeam?.id) return
    return onSnapshot(
      collection(db, 'leagues', leagueId, 'teams', fixture.homeTeam.id, 'players'),
      snap => setHomePlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [leagueId, fixture?.homeTeam?.id])

  useEffect(() => {
    if (!leagueId || !fixture?.awayTeam?.id) return
    return onSnapshot(
      collection(db, 'leagues', leagueId, 'teams', fixture.awayTeam.id, 'players'),
      snap => setAwayPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [leagueId, fixture?.awayTeam?.id])

  // ── Firestore save ────────────────────────────────────
  const save = async (updates) => {
    setBusy(true)
    try {
      await updateDoc(doc(db, 'leagues', leagueId, 'fixtures', fixtureId), updates)
      checkPending()
    } catch (err) {
      console.error('Fixture save failed:', err)
      showToast('Save failed. Check your connection and try again.')
      throw err
    } finally {
      setBusy(false)
    }
  }

  // ── Score actions ─────────────────────────────────────
  const addPoint = (side) => {
    if (fixture.status === 'completed') return
    const curSet = fixture.sets[fixture.currentSet] || emptySet()
    const newH = side === 'home' ? (curSet.home || 0) + 1 : (curSet.home || 0)
    const newA = side === 'away' ? (curSet.away || 0) + 1 : (curSet.away || 0)
    const wouldWin = checkSetWinner(newH, newA)
    if (wouldWin) {
      const winnerName = wouldWin === 'home' ? fixture.homeTeam?.name : fixture.awayTeam?.name
      setConfirmPending({ side, winnerName, score: `${newH} – ${newA}` })
      return
    }
    doAddPoint(side)
  }

  const doAddPoint = async (side) => {
    if (fixture.status === 'completed') return
    const sets = fixture.sets.map((s, i) => {
      if (i !== fixture.currentSet) return s
      const updated = { ...s, [side]: (s[side] || 0) + 1 }
      updated.winner = checkSetWinner(updated.home, updated.away)
      return updated
    })
    const sH = sets.filter(s => s.winner === 'home').length
    const sA = sets.filter(s => s.winner === 'away').length
    const updates = { sets, status: 'live' }

    // Flip serving team every rally
    if (fixture.servingTeam) {
      updates.servingTeam = fixture.servingTeam === 'home' ? 'away' : 'home'
    }

    const matchOver = sH >= SETS_TO_WIN || sA >= SETS_TO_WIN

    if (matchOver && fixture.status !== 'completed') {
      // Always mark completed — even on retry after a failed save.
      // This prevents the "3rd set at 0-0" bug where a save failure + retry
      // skips the completed status because completingRef was already set.
      updates.status        = 'completed'
      updates.homeScore     = sH
      updates.awayScore     = sA
      updates.completedDate = new Date().toISOString().split('T')[0]

      // Guard stats writes only — prevents double-increment on rapid tap or retry
      if (!completingRef.current) {
        completingRef.current = true

        // Total points scored across all sets
        const totalHome = sets.reduce((sum, s) => sum + (s.home || 0), 0)
        const totalAway = sets.reduce((sum, s) => sum + (s.away || 0), 0)
        const homeWon   = sH >= SETS_TO_WIN
        const ev        = fixture.event // 'Regu' | 'Quad' | etc.

        // Helper: build event-namespaced stat update
        const homeStats = ev ? {
          [`eventStats.${ev}.p`]:          increment(1),
          [`eventStats.${ev}.w`]:          increment(homeWon ? 1 : 0),
          [`eventStats.${ev}.l`]:          increment(homeWon ? 0 : 1),
          [`eventStats.${ev}.pts`]:        increment(homeWon ? 2 : 0),
          [`eventStats.${ev}.setsWon`]:    increment(sH),
          [`eventStats.${ev}.setsLost`]:   increment(sA),
          [`eventStats.${ev}.ptsFor`]:     increment(totalHome),
          [`eventStats.${ev}.ptsAgainst`]: increment(totalAway),
        } : {}

        const awayStats = ev ? {
          [`eventStats.${ev}.p`]:          increment(1),
          [`eventStats.${ev}.w`]:          increment(homeWon ? 0 : 1),
          [`eventStats.${ev}.l`]:          increment(homeWon ? 1 : 0),
          [`eventStats.${ev}.pts`]:        increment(homeWon ? 0 : 2),
          [`eventStats.${ev}.setsWon`]:    increment(sA),
          [`eventStats.${ev}.setsLost`]:   increment(sH),
          [`eventStats.${ev}.ptsFor`]:     increment(totalAway),
          [`eventStats.${ev}.ptsAgainst`]: increment(totalHome),
        } : {}

        try {
          // Update home team stats
          await updateDoc(doc(db, 'leagues', leagueId, 'teams', fixture.homeTeam.id), homeStats)
          // Update away team stats
          await updateDoc(doc(db, 'leagues', leagueId, 'teams', fixture.awayTeam.id), awayStats)
          // Auto-recalculate full league table from fixture data to ensure accuracy
          await recalc(leagueId)
          // Check if ALL fixtures in league are now completed → auto-complete league
          const allFixSnap = await getDocs(collection(db, 'leagues', leagueId, 'fixtures'))
          const allDone = allFixSnap.docs.every(d => {
            const data = d.data()
            return d.id === fixtureId ? true : data.status === 'completed'
          })
          if (allDone) {
            await updateDoc(doc(db, 'leagues', leagueId), { status: 'completed' })
          }
        } catch (err) {
          completingRef.current = false   // allow full retry on next attempt
          console.error('Stats write failed:', err)
          showToast('Stats update failed. Use Recalculate in League Table to fix.')
        }
      }
    }

    await save(updates)
  }

  const subPoint = async (side) => {
    const sets = fixture.sets.map((s, i) => {
      if (i !== fixture.currentSet) return s
      const updated = { ...s, [side]: Math.max(0, (s[side] || 0) - 1) }
      updated.winner = checkSetWinner(updated.home, updated.away)
      return updated
    })
    const updates = { sets }
    if (fixture.servingTeam) {
      updates.servingTeam = fixture.servingTeam === 'home' ? 'away' : 'home'
    }
    try {
      await save(updates)
    } catch {
      showToast('Failed to subtract point. Try again.')
    }
  }

  const nextSet = async () => {
    if (fixture.currentSet >= MAX_SETS - 1) return
    if (fixture.status === 'completed') return
    const sets = [...fixture.sets, emptySet()]
    const updates = { sets, currentSet: fixture.currentSet + 1 }
    if (fixture.lineup) updates.lineup = fixture.lineup
    // Alternate starting server each set
    if (fixture.servingTeam) {
      updates.servingTeam = fixture.servingTeam === 'home' ? 'away' : 'home'
    }
    try {
      await save(updates)
    } catch {
      showToast('Failed to start next set. Try again.')
    }
  }

  const editSetScore = async (setIndex, side, delta) => {
    const updatedSets = fixture.sets.map((s, i) => {
      if (i !== setIndex) return s
      const updated = { ...s, [side]: Math.max(0, (s[side] || 0) + delta) }
      updated.winner = checkSetWinner(updated.home, updated.away)
      return updated
    })
    const sH = updatedSets.filter(s => s.winner === 'home').length
    const sA = updatedSets.filter(s => s.winner === 'away').length
    const updates = { sets: updatedSets }
    if (sH >= SETS_TO_WIN || sA >= SETS_TO_WIN) {
      updates.status    = 'completed'
      updates.homeScore = sH
      updates.awayScore = sA
    }
    try {
      await save(updates)
    } catch {
      showToast('Failed to update score. Try again.')
    }
  }

  const removeLastSet = async () => {
    if (fixture.sets.length <= 1) return
    const trimmed = fixture.sets.slice(0, -1)
    const newCur  = Math.min(fixture.currentSet, trimmed.length - 1)
    const sH = trimmed.filter(s => s.winner === 'home').length
    const sA = trimmed.filter(s => s.winner === 'away').length
    const updates = { sets: trimmed, currentSet: newCur }
    if (sH >= SETS_TO_WIN || sA >= SETS_TO_WIN) {
      updates.status    = 'completed'
      updates.homeScore = sH
      updates.awayScore = sA
    } else {
      updates.status    = 'live'
      updates.homeScore = null
      updates.awayScore = null
    }
    try {
      await save(updates)
    } catch {
      showToast('Failed to remove set. Try again.')
    }
  }

  const buildLineup = (allPlayers, startingIds) =>
    allPlayers.map(p => ({ id: p.id, name: p.name, role: p.role || 'Player', position: p.position || null, photoUrl: p.photoUrl || null, status: startingIds.includes(p.id) ? 'playing' : 'bench' }))

  const courtSize   = fixture?.event === 'Quad' ? 4 : 3
  const lineupReady = homeStarting.length === courtSize && awayStarting.length === courtSize

  const startMatch = async () => {
    if (!lineupReady) return
    const updates = { status: 'live', sets: [emptySet()], currentSet: 0, homeScore: null, awayScore: null }
    if (liveUrl.trim()) updates.liveUrl = liveUrl.trim()
    updates.lineup = {
      home: buildLineup(homePlayers, homeStarting),
      away: buildLineup(awayPlayers, awayStarting),
    }
    if (tossData.servingFirst) {
      updates.servingTeam = tossData.servingFirst
      updates.toss = {
        method:       tossData.coinResult ? 'coin' : 'manual',
        winnerSide:   tossData.winnerSide || tossData.servingFirst,
        winnerChoice: tossData.winnerChoice || 'serve',
        servingFirst: tossData.servingFirst,
        ...(tossData.coinResult ? { callerSide: tossData.callerSide, callerChoice: tossData.callerChoice, coinResult: tossData.coinResult } : {}),
      }
    }
    try {
      await save(updates)
      // Auto-activate league when first match goes live
      const leagueRef  = doc(db, 'leagues', leagueId)
      const leagueSnap = await getDoc(leagueRef)
      if (leagueSnap.exists() && leagueSnap.data().status === 'upcoming') {
        await updateDoc(leagueRef, { status: 'active' })
      }
    } catch {
      showToast('Failed to start match. Try again.')
    }
  }

  // Called from SubReentryModal with { outId, inId }
  const applySwap = async (side, { outId, inId }, type) => {
    const lineup = fixture.lineup || { home: [], away: [] }
    const outPlayer = lineup[side]?.find(p => p.id === outId)
    const inPlayer  = lineup[side]?.find(p => p.id === inId)
    const updated = { ...lineup, [side]: lineup[side].map(p => {
      if (p.id === outId) return { ...p, status: 'bench',   event: 'subOut'             }
      if (p.id === inId)  return { ...p, status: 'playing', event: type === 'reentry' ? 'reentry' : 'subIn' }
      return p
    })}
    const teamName = side === 'home' ? fixture.homeTeam?.name : fixture.awayTeam?.name
    try {
      await save({
        lineup: updated,
        subAlert: {
          type,
          teamName,
          outName: outPlayer?.name || '',
          inName:  inPlayer?.name  || '',
          at: Date.now(),
        }
      })
      setSubModal(null)
    } catch {
      showToast('Failed to apply substitution. Try again.')
    }
  }

  // ── Timeout ───────────────────────────────────────────
  const callTimeout = async (side) => {
    const sets = fixture.sets.map((s, i) =>
      i === fixture.currentSet ? { ...s, [`${side}Timeout`]: true } : s
    )
    try {
      await save({ sets, timeoutActive: { side, startedAt: Date.now() } })
      setTimeoutState({ side, remaining: TIMEOUT_SEC })
    } catch {
      showToast('Failed to record timeout. Try again.')
    }
  }

  // ── Sub / Re-entry ────────────────────────────────────
  const useSub = async (side) => {
    const sets = fixture.sets.map((s, i) => {
      if (i !== fixture.currentSet) return s
      return { ...s, [`${side}Subs`]: (s[`${side}Subs`] || 0) + 1 }
    })
    try {
      await save({ sets })
    } catch {
      showToast('Failed to record substitution. Try again.')
    }
  }

  const useReentry = async (side) => {
    const sets = fixture.sets.map((s, i) => {
      if (i !== fixture.currentSet) return s
      return { ...s, [`${side}Reentries`]: (s[`${side}Reentries`] || 0) + 1 }
    })
    try {
      await save({ sets })
    } catch {
      showToast('Failed to record re-entry. Try again.')
    }
  }

  // ── Guards ────────────────────────────────────────────
  if (!fixtureId) return <GenericScoring />
  if (loading) return (
    <div className="page">
      {/* Score panel skeleton */}
      <div className="card" style={{ marginBottom: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="skeleton" style={{ width: 80, height: 10, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: 60, height: 10, borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div className="skeleton" style={{ width: 52, height: 52, borderRadius: '50%' }} />
            <div className="skeleton" style={{ width: '70%', height: 12, borderRadius: 4 }} />
          </div>
          <div className="skeleton" style={{ width: 70, height: 48, borderRadius: 10 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div className="skeleton" style={{ width: 52, height: 52, borderRadius: '50%' }} />
            <div className="skeleton" style={{ width: '70%', height: 12, borderRadius: 4 }} />
          </div>
        </div>
      </div>
      {/* Sets skeleton */}
      {[0,1,2].map(i => (
        <div key={i} className="card" style={{ marginBottom: 10, padding: '12px 16px' }}>
          <div className="skeleton" style={{ width: '40%', height: 10, borderRadius: 4, marginBottom: 10 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="skeleton" style={{ width: '30%', height: 36, borderRadius: 8 }} />
            <div className="skeleton" style={{ width: 40, height: 36, borderRadius: 8 }} />
            <div className="skeleton" style={{ width: '30%', height: 36, borderRadius: 8 }} />
          </div>
        </div>
      ))}
    </div>
  )
  if (!fixture) return (
    <div className="page" style={{ textAlign: 'center', paddingTop: 60 }}>
      <p style={{ fontWeight: 700 }}>Match not found.</p>
      <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>Go back</button>
    </div>
  )

  // ── Derived state ─────────────────────────────────────
  const sets       = fixture.sets || [emptySet()]
  const cur        = fixture.currentSet || 0
  const curSet     = sets[cur] || emptySet()
  const setsHome   = sets.filter(s => s.winner === 'home').length
  const setsAway   = sets.filter(s => s.winner === 'away').length
  const isLive      = fixture.status === 'live'
  const isCompleted = fixture.status === 'completed'
  const setWon      = !!curSet.winner && isLive
  const deuce       = isDeuce(curSet.home, curSet.away) && !curSet.winner
  const canNextSet  = setWon && cur < MAX_SETS - 1 && !isCompleted
  const matchWinner = isCompleted
    ? (fixture.homeScore >= SETS_TO_WIN ? fixture.homeTeam?.name : fixture.awayTeam?.name)
    : null

  return (
    <div className="page" style={{ paddingBottom: 100 }}>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'error' ? '#dc2626' : '#16a34a',
          color: '#fff', padding: '10px 18px', borderRadius: 10,
          fontSize: '0.82rem', fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)', maxWidth: 320, textAlign: 'center',
          pointerEvents: 'none',
        }}>
          {toast.message}
        </div>
      )}

      {/* Timeout overlay — admin full screen */}
      {timeoutState && isAdmin && (
        <TimeoutOverlay
          remaining={timeoutState.remaining}
          teamName={timeoutState.side === 'home' ? fixture.homeTeam?.name : fixture.awayTeam?.name}
          onDismiss={() => { setTimeoutState(null); save({ timeoutActive: null }) }}
        />
      )}

      {/* Timeout pill — viewer floating widget */}
      {!isAdmin && fixture?.timeoutActive && (
        <ViewerTimeoutPill
          timeoutActive={fixture.timeoutActive}
          homeTeam={fixture.homeTeam?.name}
          awayTeam={fixture.awayTeam?.name}
        />
      )}

      {/* Sub/reentry alert — viewer popup */}
      {!isAdmin && fixture?.subAlert && (
        <ViewerSubAlert subAlert={fixture.subAlert} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button aria-label="Go back" onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: '4px 0', flexShrink: 0 }}>
          <BackIcon />
        </button>
        <div style={{ flex: 1 }}>
          <p className="page-subtitle">
            {fixture.event ? `${EVENT_ICON[fixture.event] || ''} ${fixture.event} · Leg ${fixture.leg}` : 'Match'}
          </p>
          <h1 className="page-title" style={{ fontSize: '1.15rem' }}>Live Score</h1>
        </div>
        <ViewerCount fixtureId={fixtureId} />
        {syncPending && (
          <span style={{ fontSize: '0.7rem', background: '#f59e0b', color: '#fff', borderRadius: 999, padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Syncing…
          </span>
        )}
        {isLive && !setWon && <span className="badge badge-live"><span className="live-dot" />Live</span>}
        {isCompleted && <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, background: 'rgba(107,114,128,0.1)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.2)' }}>Full Time</span>}
      </div>

      {/* User notice */}
      {!isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <EyeIcon />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', fontWeight: 500 }}>You are viewing live scores. Only admins can update the score.</p>
        </div>
      )}

      {/* Match winner */}
      {isCompleted && matchWinner && (
        <div style={{ background: 'linear-gradient(135deg,rgba(255,85,0,0.1),rgba(255,179,0,0.1))', border: '1px solid rgba(255,85,0,0.25)', borderRadius: 14, padding: '16px 20px', marginBottom: 14, textAlign: 'center' }}>
          <p style={{ fontSize: '1.5rem', marginBottom: 4 }}>🏆</p>
          <p style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--accent)' }}>{matchWinner}</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginTop: 2 }}>Wins the match {setsHome}–{setsAway}</p>
        </div>
      )}

      {/* ── Coin Toss Flow ── */}
      {isAdmin && fixture.status === 'scheduled' && tossPhase !== 'done' && (() => {
        const homeName = fixture.homeTeam?.name || 'Home'
        const awayName = fixture.awayTeam?.name || 'Away'
        const nameOf = side => side === 'home' ? homeName : awayName

        // Step: pretoss — choose method
        if (tossPhase === 'pretoss') return (
          <div className="card" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>Coin Toss</p>
            <button onClick={() => setTossPhase('toss_call')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-elevated)', cursor: 'pointer', marginBottom: 8, fontFamily: 'inherit' }}>
              <span style={{ fontSize: '1.4rem' }}>🪙</span>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-1)' }}>Do coin toss in app</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-2)', fontWeight: 500 }}>Flip a coin to decide who serves</p>
              </div>
            </button>
            <button onClick={() => setTossPhase('manual_pick')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-elevated)', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: '1.4rem' }}>👆</span>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-1)' }}>Skip toss</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-2)', fontWeight: 500 }}>Pick which team serves first</p>
              </div>
            </button>
          </div>
        )

        // Step: toss_call — pick who calls and what they call
        if (tossPhase === 'toss_call') return (
          <div className="card" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>Who calls the toss?</p>
            {['home', 'away'].map(side => (
              <div key={side} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${tossData.callerSide === side ? 'var(--accent)' : 'var(--border)'}`, background: tossData.callerSide === side ? 'var(--accent-dim)' : 'var(--bg-elevated)', marginBottom: 8, cursor: 'pointer' }}
                onClick={() => setTossData(d => ({ ...d, callerSide: side, callerChoice: null }))}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{nameOf(side)}</span>
                {tossData.callerSide === side && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['Heads', 'Tails'].map(c => (
                      <button key={c} onClick={e => { e.stopPropagation(); setTossData(d => ({ ...d, callerChoice: c.toLowerCase() })) }}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1.5px solid', borderColor: tossData.callerChoice === c.toLowerCase() ? 'var(--accent)' : 'var(--border)', background: tossData.callerChoice === c.toLowerCase() ? 'var(--accent)' : 'var(--bg-card)', color: tossData.callerChoice === c.toLowerCase() ? '#fff' : 'var(--text-2)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => setTossPhase('pretoss')} style={{ flex: 1, height: 44 }}>Back</button>
              <button className="btn btn-primary" onClick={() => {
                const result = Math.random() < 0.5 ? 'heads' : 'tails'
                const callerWon = result === tossData.callerChoice
                const winnerSide = callerWon ? tossData.callerSide : (tossData.callerSide === 'home' ? 'away' : 'home')
                setTossData(d => ({ ...d, coinResult: result, winnerSide }))
                setTossPhase('toss_result')
              }} disabled={!tossData.callerSide || !tossData.callerChoice} style={{ flex: 2, height: 44, opacity: (!tossData.callerSide || !tossData.callerChoice) ? 0.45 : 1 }}>
                🪙 Flip Coin
              </button>
            </div>
          </div>
        )

        // Step: toss_result — show coin result
        if (tossPhase === 'toss_result') return (
          <div className="card" style={{ marginBottom: 14, textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--gold)', border: '3px solid #b37400', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '1px' }}>{tossData.coinResult}</span>
            </div>
            <p style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>
              {nameOf(tossData.winnerSide)} wins the toss!
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginBottom: 16 }}>
              {nameOf(tossData.callerSide)} called {tossData.callerChoice} · coin landed {tossData.coinResult}
            </p>
            <button className="btn btn-primary" onClick={() => setTossPhase('toss_pick')} style={{ width: '100%', height: 46 }}>
              Continue
            </button>
          </div>
        )

        // Step: toss_pick — winner chooses serve or side
        if (tossPhase === 'toss_pick') return (
          <div className="card" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>
              {nameOf(tossData.winnerSide)} won — choose
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginBottom: 12, fontWeight: 500 }}>What does {nameOf(tossData.winnerSide)} prefer?</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[{ key: 'serve', label: 'Serve First', icon: '🏐' }, { key: 'side', label: 'Pick Side', icon: '↔️' }].map(opt => (
                <button key={opt.key} onClick={() => {
                  const servingFirst = opt.key === 'serve' ? tossData.winnerSide : (tossData.winnerSide === 'home' ? 'away' : 'home')
                  setTossData(d => ({ ...d, winnerChoice: opt.key, servingFirst }))
                }}
                  style={{ padding: '16px 10px', borderRadius: 10, border: `1.5px solid ${tossData.winnerChoice === opt.key ? 'var(--accent)' : 'var(--border)'}`, background: tossData.winnerChoice === opt.key ? 'var(--accent-dim)' : 'var(--bg-elevated)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{opt.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: tossData.winnerChoice === opt.key ? 'var(--accent)' : 'var(--text-1)' }}>{opt.label}</div>
                  {opt.key === 'serve' && tossData.winnerChoice === 'serve' && <div style={{ fontSize: '0.68rem', color: 'var(--accent)', marginTop: 2 }}>{nameOf(tossData.winnerSide)} serves</div>}
                  {opt.key === 'side' && tossData.winnerChoice === 'side' && <div style={{ fontSize: '0.68rem', color: 'var(--accent)', marginTop: 2 }}>{nameOf(tossData.servingFirst)} serves</div>}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setTossPhase('toss_result')} style={{ flex: 1, height: 44 }}>Back</button>
              <button className="btn btn-primary" onClick={() => setTossPhase('done')} disabled={!tossData.winnerChoice} style={{ flex: 2, height: 44, opacity: !tossData.winnerChoice ? 0.45 : 1 }}>
                Confirm
              </button>
            </div>
          </div>
        )

        // Step: manual_pick — admin picks serving team directly
        if (tossPhase === 'manual_pick') return (
          <div className="card" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>Which team serves first?</p>
            {['home', 'away'].map(side => (
              <div key={side} onClick={() => setTossData(d => ({ ...d, servingFirst: side, winnerSide: side, winnerChoice: 'serve' }))}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderRadius: 10, border: `1.5px solid ${tossData.servingFirst === side ? 'var(--accent)' : 'var(--border)'}`, background: tossData.servingFirst === side ? 'var(--accent-dim)' : 'var(--bg-elevated)', marginBottom: 8, cursor: 'pointer' }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{nameOf(side)}</span>
                <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${tossData.servingFirst === side ? 'var(--accent)' : 'var(--border)'}`, background: tossData.servingFirst === side ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {tossData.servingFirst === side && <span style={{ color: '#fff', fontSize: '0.6rem', fontWeight: 900 }}>✓</span>}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => { setTossPhase('pretoss'); setTossData(d => ({ ...d, servingFirst: null })) }} style={{ flex: 1, height: 44 }}>Back</button>
              <button className="btn btn-primary" onClick={() => setTossPhase('done')} disabled={!tossData.servingFirst} style={{ flex: 2, height: 44, opacity: !tossData.servingFirst ? 0.45 : 1 }}>
                Confirm
              </button>
            </div>
          </div>
        )

        return null
      })()}

      {/* Start match */}
      {isAdmin && fixture.status === 'scheduled' && tossPhase === 'done' && (
        <div style={{ marginBottom: 12 }}>
          {/* Live stream URL */}
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>
            Live Stream URL <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </p>
          <input
            type="url"
            placeholder="https://youtube.com/live/..."
            value={liveUrl}
            onChange={e => setLiveUrl(e.target.value)}
            style={{ width: '100%', height: 44, borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-card)', padding: '0 14px', fontSize: '0.85rem', fontFamily: 'inherit', color: 'var(--text-1)', marginBottom: 12, boxSizing: 'border-box', outline: 'none' }}
          />

          {/* Lineup picker — mandatory */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                👕 Starting Lineup <span style={{ color: '#dc2626' }}>*</span>
              </p>
              {!lineupReady && (
                <span style={{ fontSize: '0.65rem', color: '#dc2626', fontWeight: 600 }}>Select {courtSize} players per team</span>
              )}
              {lineupReady && (
                <span style={{ fontSize: '0.65rem', color: '#16a34a', fontWeight: 700 }}>✓ Ready</span>
              )}
            </div>
            <LineupPicker
              event={fixture.event}
              homeTeam={fixture.homeTeam} homePlayers={homePlayers}
              awayTeam={fixture.awayTeam} awayPlayers={awayPlayers}
              homeStarting={homeStarting} setHomeStarting={setHomeStarting}
              awayStarting={awayStarting} setAwayStarting={setAwayStarting}
            />
          </div>

          <button className="btn btn-primary" onClick={startMatch} disabled={busy || !lineupReady}
            style={{ width: '100%', height: 46, fontSize: '0.95rem', opacity: lineupReady ? 1 : 0.45, cursor: lineupReady ? 'pointer' : 'not-allowed' }}>
            ▶ Start Match
          </button>
        </div>
      )}

      {/* Undo Start — admin only, only when no points scored yet */}
      {isAdmin && isLive && sets.length === 1 && curSet.home === 0 && curSet.away === 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={async () => {
              if (!window.confirm('Undo match start? This will reset the match back to scheduled.')) return
              await save({ status: 'scheduled', sets: null, currentSet: null, lineup: null, liveUrl: null, homeScore: null, awayScore: null, servingTeam: null, toss: null })
              setTossPhase('pretoss')
              setTossData({ callerSide: null, callerChoice: null, coinResult: null, winnerSide: null, winnerChoice: null, servingFirst: null })
            }}
            disabled={busy}
            style={{ width: '100%', height: 42, borderRadius: 10, border: '1.5px solid rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.06)', color: '#dc2626', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↩ Undo Start Match
          </button>
        </div>
      )}

      {/* Watch Live button — shown when liveUrl is set */}
      {fixture.liveUrl && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <a href={fixture.liveUrl} target="_blank" rel="noopener noreferrer"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1.5px solid rgba(239,68,68,0.25)', color: '#dc2626', fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none' }}>
            📺 Watch Live Stream
          </a>
          {isAdmin && isLive && (
            <button onClick={() => save({ liveUrl: '' })} disabled={busy}
              title="Remove live link"
              style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', cursor: 'pointer', fontSize: '1rem' }}>
              ✕
            </button>
          )}
        </div>
      )}

      {/* Sets overview */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <TeamHeader team={fixture.homeTeam} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span style={{ fontWeight: 900, fontSize: '1.5rem', color: setsHome >= setsAway ? 'var(--accent)' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{setsHome}</span>
            <span style={{ color: 'var(--text-3)', fontSize: '0.6rem', fontWeight: 700, letterSpacing: 1 }}>SETS</span>
            <span style={{ fontWeight: 900, fontSize: '1.5rem', color: setsAway >= setsHome ? 'var(--accent)' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{setsAway}</span>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {Array.from({ length: MAX_SETS }).map((_, i) => {
              const w = sets[i]?.winner
              return <div key={i} style={{ width: 24, height: 7, borderRadius: 4, background: w === 'home' ? 'var(--accent)' : w === 'away' ? '#64748b' : i === cur && isLive ? 'rgba(255,85,0,0.25)' : 'var(--border)', transition: 'background 300ms ease' }} />
            })}
          </div>
        </div>
        <TeamHeader team={fixture.awayTeam} right />
      </div>

      {/* Set won banner */}
      {setWon && (
        <div style={{ background: 'linear-gradient(135deg,rgba(255,85,0,0.08),rgba(255,179,0,0.08))', border: '1.5px solid rgba(255,85,0,0.3)', borderRadius: 14, padding: '16px 20px', marginBottom: 12, textAlign: 'center' }}>
          <p style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--accent)', marginBottom: 4 }}>
            🎉 Set {cur + 1} won by {curSet.winner === 'home' ? fixture.homeTeam?.name : fixture.awayTeam?.name}!
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginBottom: isAdmin ? 12 : 0 }}>{curSet.home} – {curSet.away}</p>
          {isAdmin && canNextSet && (
            <button className="btn btn-primary" onClick={nextSet} disabled={busy} style={{ height: 40, padding: '0 24px', fontSize: '0.88rem' }}>Start Set {cur + 2} →</button>
          )}
        </div>
      )}

      {/* Deuce */}
      {deuce && !setWon && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🔥</span>
          <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#dc2626' }}>Deuce! First to {DEUCE_WIN} wins this set.</p>
        </div>
      )}

      {/* Toss info strip */}
      {fixture.toss && isLive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.15)', borderRadius: 10, padding: '8px 14px', marginBottom: 10 }}>
          <span style={{ fontSize: '0.95rem' }}>🪙</span>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', fontWeight: 600 }}>
            {fixture.toss.winnerSide === 'home' ? fixture.homeTeam?.name : fixture.awayTeam?.name} won toss
            {fixture.toss.winnerChoice ? ` · chose to ${fixture.toss.winnerChoice}` : ''}
          </p>
        </div>
      )}

      {/* Scoreboard */}
      {!setWon && (
        <div className="card" style={{ padding: '20px 16px 18px', marginBottom: 12, border: isLive ? '1px solid rgba(255,85,0,0.15)' : '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
          {isLive && <div style={{ height: 3, background: 'linear-gradient(90deg,#ff5500,#ffb300)', position: 'absolute', top: 0, left: 0, right: 0 }} />}
          <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 18 }}>
            Set {cur + 1} · First to {deuce ? DEUCE_WIN : WIN_PTS}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 8 }}>
            {isAdmin && !isCompleted ? (
              <>
                <AdminControl label={fixture.homeTeam?.name} score={curSet.home} leading={curSet.home > curSet.away} onAdd={() => addPoint('home')} onSub={() => subPoint('home')} busy={busy} isServing={fixture.servingTeam === 'home'} />
                <span style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--border)' }}>:</span>
                <AdminControl label={fixture.awayTeam?.name} score={curSet.away} leading={curSet.away > curSet.home} onAdd={() => addPoint('away')} onSub={() => subPoint('away')} busy={busy} isServing={fixture.servingTeam === 'away'} />
              </>
            ) : (
              <>
                <ReadOnlyScore label={fixture.homeTeam?.name} score={curSet.home} leading={curSet.home > curSet.away} logo={fixture.homeTeam?.logoUrl} isServing={fixture.servingTeam === 'home'} />
                <span style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--border)' }}>:</span>
                <ReadOnlyScore label={fixture.awayTeam?.name} score={curSet.away} leading={curSet.away > curSet.home} logo={fixture.awayTeam?.logoUrl} isServing={fixture.servingTeam === 'away'} />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Team action panels (Timeout / Sub / Re-entry) ── */}
      {isLive && !setWon && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <TeamActionPanel
            teamName={fixture.homeTeam?.name}
            logoUrl={fixture.homeTeam?.logoUrl}
            side="home"
            timeoutUsed={curSet.homeTimeout}
            subs={curSet.homeSubs || 0}
            reentries={curSet.homeReentries || 0}
            isAdmin={isAdmin}
            busy={busy}
            onTimeout={() => callTimeout('home')}
            onSub={() => fixture.lineup ? setSubModal({ side: 'home', type: 'sub' }) : useSub('home')}
            onReentry={() => fixture.lineup ? setSubModal({ side: 'home', type: 'reentry' }) : useReentry('home')}
            timeoutActive={timeoutState?.side === 'home' ? timeoutState.remaining : null}
          />
          <TeamActionPanel
            teamName={fixture.awayTeam?.name}
            logoUrl={fixture.awayTeam?.logoUrl}
            side="away"
            timeoutUsed={curSet.awayTimeout}
            subs={curSet.awaySubs || 0}
            reentries={curSet.awayReentries || 0}
            isAdmin={isAdmin}
            busy={busy}
            onTimeout={() => callTimeout('away')}
            onSub={() => fixture.lineup ? setSubModal({ side: 'away', type: 'sub' }) : useSub('away')}
            onReentry={() => fixture.lineup ? setSubModal({ side: 'away', type: 'reentry' }) : useReentry('away')}
            timeoutActive={timeoutState?.side === 'away' ? timeoutState.remaining : null}
          />
        </div>
      )}

      {/* Set history */}
      {sets.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="card-label" style={{ marginBottom: 0 }}>Set History</p>
            {isAdmin && (
              <button onClick={() => setEditScoresMode(v => !v)}
                style={{ fontSize: '0.68rem', fontWeight: 700, padding: '3px 10px', borderRadius: 8, border: `1.5px solid ${editScoresMode ? 'var(--accent)' : 'var(--border)'}`, background: editScoresMode ? 'var(--accent-dim)' : 'var(--bg-elevated)', color: editScoresMode ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {editScoresMode ? 'Done Editing' : 'Edit Scores'}
              </button>
            )}
          </div>

          {sets.map((s, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: i < sets.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', fontWeight: 600, minWidth: 46 }}>Set {i + 1}</span>
                  {i === cur && isLive && !setWon && <span className="badge badge-live" style={{ fontSize: '0.58rem' }}>Now</span>}
                  {s.winner && (
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(255,85,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,85,0,0.15)' }}>
                      {s.winner === 'home' ? fixture.homeTeam?.name : fixture.awayTeam?.name} won
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '1rem', color: s.home > s.away ? 'var(--text-1)' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{s.home}</span>
                  <span style={{ color: 'var(--text-3)', fontWeight: 700 }}>–</span>
                  <span style={{ fontWeight: 800, fontSize: '1rem', color: s.away > s.home ? 'var(--text-1)' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{s.away}</span>
                </div>
              </div>

              {editScoresMode && isAdmin && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[{ label: fixture.homeTeam?.name, side: 'home', score: s.home },
                    { label: fixture.awayTeam?.name, side: 'away', score: s.away }].map(({ label, side, score }) => (
                    <div key={side} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', borderRadius: 8, padding: '6px 10px', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>{label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => editSetScore(i, side, -1)} disabled={busy || score <= 0}
                          style={{ width: 26, height: 26, borderRadius: 6, border: '1.5px solid var(--border)', background: 'var(--bg-card)', fontWeight: 900, fontSize: '1rem', cursor: score > 0 ? 'pointer' : 'default', color: 'var(--text-2)', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                        <span style={{ fontWeight: 800, fontSize: '0.95rem', minWidth: 18, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{score}</span>
                        <button onClick={() => editSetScore(i, side, +1)} disabled={busy}
                          style={{ width: 26, height: 26, borderRadius: 6, border: '1.5px solid var(--accent)', background: 'var(--accent-dim)', fontWeight: 900, fontSize: '1rem', cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {editScoresMode && isAdmin && sets.length > 1 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button onClick={removeLastSet} disabled={busy}
                style={{ width: '100%', height: 38, borderRadius: 10, border: '1.5px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)', color: '#dc2626', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Remove Set {sets.length} (undo accidental set)
              </button>
            </div>
          )}
        </div>
      )}


      {/* ── Lineup display (everyone sees) ── */}
      {fixture.lineup && (
        <LineupDisplay lineup={fixture.lineup} homeTeam={fixture.homeTeam} awayTeam={fixture.awayTeam} />
      )}


      {/* ── Set complete confirmation ── */}
      {confirmPending && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}
          onClick={() => setConfirmPending(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 20, padding: '24px 20px', width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
            onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: '1.8rem', textAlign: 'center', marginBottom: 10 }}>🏆</p>
            <p style={{ fontWeight: 900, fontSize: '1rem', textAlign: 'center', marginBottom: 6 }}>Set Complete?</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-2)', textAlign: 'center', marginBottom: 4 }}>
              <strong>{confirmPending.winnerName}</strong> wins this set
            </p>
            <p style={{ fontSize: '1.1rem', fontWeight: 900, textAlign: 'center', color: 'var(--accent)', marginBottom: 20, fontVariantNumeric: 'tabular-nums' }}>
              {confirmPending.score}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmPending(null)}
                style={{ flex: 1, height: 46, borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--bg-elevated)', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', color: 'var(--text-2)' }}>
                Cancel
              </button>
              <button onClick={() => { const s = confirmPending.side; setConfirmPending(null); doAddPoint(s) }}
                disabled={busy}
                style={{ flex: 1, height: 46, borderRadius: 12, border: 'none', background: 'var(--accent)', fontFamily: 'inherit', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', color: '#fff' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub / Re-entry modal ── */}
      {subModal && (
        <SubReentryModal
          type={subModal.type}
          lineup={fixture.lineup?.[subModal.side] || []}
          teamName={subModal.side === 'home' ? fixture.homeTeam?.name : fixture.awayTeam?.name}
          onConfirm={async (swap) => {
            const fn = subModal.type === 'sub' ? useSub : useReentry
            await fn(subModal.side)
            await applySwap(subModal.side, swap, subModal.type)
          }}
          onCancel={() => setSubModal(null)}
        />
      )}

      {/* Rules reference */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
        <p style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Rules</p>
        {[
          `${MAX_SETS} sets · First to ${WIN_PTS} pts wins a set`,
          `At ${DEUCE_AT}–${DEUCE_AT}, first to ${DEUCE_WIN} wins`,
          '1 timeout per team per set (1 min)',
          '2 subs OR 1 sub + 1 re-entry per team per set',
        ].map((r, i) => (
          <p key={i} style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginBottom: 4, display: 'flex', gap: 7 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>·</span>{r}
          </p>
        ))}
      </div>

    </div>
  )
}

// ── Team action panel ─────────────────────────────────────
function TeamActionPanel({ teamName, logoUrl, side, timeoutUsed, subs, reentries, isAdmin, busy, onTimeout, onSub, onReentry, timeoutActive }) {
  const totalChanges  = subs + reentries
  const canSub        = totalChanges < MAX_CHANGES
  const canReentry    = reentries < MAX_REENTRY && totalChanges < MAX_CHANGES

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>

      {/* Team name header */}
      <div style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 7 }}>
        {logoUrl
          ? <img src={logoUrl} alt={teamName} referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} />
          : <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>👥</span>}
        <p className="score-panel-name" style={{ textAlign: 'left' }}>{teamName}</p>
      </div>

      <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* ── Timeout ── */}
        <div>
          <p style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 5 }}>Timeout</p>
          {isAdmin ? (
            <button
              aria-label={timeoutUsed ? `Timeout used for ${teamName}` : `Call timeout for ${teamName}`}
              onClick={!timeoutUsed ? onTimeout : undefined}
              disabled={busy || timeoutUsed}
              style={{
                width: '100%', height: 40, borderRadius: 9, border: 'none', cursor: timeoutUsed ? 'default' : 'pointer',
                fontFamily: 'inherit', fontWeight: 700, fontSize: '0.8rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: timeoutActive !== null ? '#f59e0b' : timeoutUsed ? 'var(--bg-elevated)' : 'rgba(245,158,11,0.12)',
                color:      timeoutActive !== null ? '#fff'    : timeoutUsed ? 'var(--text-3)'    : '#b45309',
                border:     timeoutUsed ? '1px solid var(--border)' : '1.5px solid rgba(245,158,11,0.4)',
                transition: 'all 150ms ease',
              }}>
              <span style={{ fontSize: '1rem' }}>⏱</span>
              {timeoutActive !== null
                ? `${timeoutActive}s remaining`
                : timeoutUsed ? 'Timeout Used' : 'Call Timeout'}
            </button>
          ) : (
            <StatusPill used={timeoutUsed} label="Timeout" availLabel="Available" usedLabel="Used" icon="⏱" />
          )}
        </div>

        {/* ── Substitution ── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <p style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Substitution</p>
            <p style={{ fontSize: '0.6rem', fontWeight: 700, color: subs > 0 ? 'var(--accent)' : 'var(--text-3)' }}>{subs}/{MAX_CHANGES} used</p>
          </div>
          {isAdmin ? (
            <button
              aria-label={!canSub ? `No substitutions left for ${teamName}` : `Use substitution for ${teamName}`}
              onClick={canSub ? onSub : undefined}
              disabled={busy || !canSub}
              style={{
                width: '100%', height: 40, borderRadius: 9, border: 'none', cursor: canSub ? 'pointer' : 'default',
                fontFamily: 'inherit', fontWeight: 700, fontSize: '0.8rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: !canSub ? 'var(--bg-elevated)' : 'rgba(14,165,233,0.1)',
                color:      !canSub ? 'var(--text-3)'    : '#0369a1',
                border:     !canSub ? '1px solid var(--border)' : '1.5px solid rgba(14,165,233,0.3)',
                transition: 'all 150ms ease',
              }}>
              <span style={{ fontSize: '1rem' }}>🔄</span>
              {!canSub ? 'No Subs Left' : `Use Sub (${MAX_CHANGES - totalChanges} left)`}
            </button>
          ) : (
            <StatusPill used={!canSub} label="Sub" availLabel={`${MAX_CHANGES - totalChanges} left`} usedLabel="None left" icon="🔄" />
          )}
          {/* Dot indicators */}
          <div style={{ display: 'flex', gap: 5, marginTop: 6, justifyContent: 'center' }}>
            {Array.from({ length: MAX_CHANGES }).map((_, i) => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i < subs ? '#0ea5e9' : 'var(--border)', transition: 'background 200ms' }} />
            ))}
          </div>
        </div>

        {/* ── Re-entry ── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <p style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Re-entry</p>
            <p style={{ fontSize: '0.6rem', fontWeight: 700, color: reentries > 0 ? 'var(--accent)' : 'var(--text-3)' }}>{reentries}/{MAX_REENTRY} used</p>
          </div>
          {isAdmin ? (
            <button
              aria-label={!canReentry ? `Re-entry unavailable for ${teamName}` : `Use re-entry for ${teamName}`}
              onClick={canReentry ? onReentry : undefined}
              disabled={busy || !canReentry}
              style={{
                width: '100%', height: 40, borderRadius: 9, border: 'none', cursor: canReentry ? 'pointer' : 'default',
                fontFamily: 'inherit', fontWeight: 700, fontSize: '0.8rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: !canReentry ? 'var(--bg-elevated)' : 'rgba(34,197,94,0.1)',
                color:      !canReentry ? 'var(--text-3)'    : '#15803d',
                border:     !canReentry ? '1px solid var(--border)' : '1.5px solid rgba(34,197,94,0.35)',
                transition: 'all 150ms ease',
              }}>
              <span style={{ fontSize: '1rem' }}>↩️</span>
              {!canReentry
                ? (reentries >= MAX_REENTRY ? 'Re-entry Used' : 'Changes Used')
                : 'Use Re-entry'}
            </button>
          ) : (
            <StatusPill used={reentries >= MAX_REENTRY || !canReentry} label="Re-entry" availLabel="Available" usedLabel="Used" icon="↩️" />
          )}
          {/* Dot indicator */}
          <div style={{ display: 'flex', gap: 5, marginTop: 6, justifyContent: 'center' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: reentries > 0 ? '#22c55e' : 'var(--border)', transition: 'background 200ms' }} />
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Status pill (read-only) ───────────────────────────────
function StatusPill({ used, icon, availLabel, usedLabel }) {
  return (
    <div style={{ height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 700,
      background: used ? 'var(--bg-elevated)' : 'rgba(255,85,0,0.06)',
      color:      used ? 'var(--text-3)'    : 'var(--text-2)',
      border:     used ? '1px solid var(--border)' : '1px solid rgba(255,85,0,0.15)',
    }}>
      <span>{icon}</span>
      <span>{used ? usedLabel : availLabel}</span>
    </div>
  )
}

// ── Timeout fullscreen overlay ────────────────────────────
function TimeoutOverlay({ remaining, teamName, onDismiss }) {
  const mins = String(Math.floor(remaining / 60)).padStart(2, '0')
  const secs = String(remaining % 60).padStart(2, '0')
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, backdropFilter: 'blur(5px)' }}>
      <p style={{ color: '#fff', fontWeight: 700, fontSize: '0.8rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 2 }}>⏱ Timeout</p>
      <p style={{ color: '#fff', fontWeight: 800, fontSize: '1.1rem' }}>{teamName}</p>
      <div style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 20, padding: '24px 52px' }}>
        <p style={{ color: '#ffb300', fontWeight: 900, fontSize: '5rem', letterSpacing: '-5px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {mins}:{secs}
        </p>
      </div>
      <button onClick={onDismiss}
        style={{ marginTop: 8, height: 42, padding: '0 28px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.88rem' }}>
        Dismiss
      </button>
    </div>
  )
}

// ── Team header (sets overview) ───────────────────────────
function TeamHeader({ team, right }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', gap: 4, overflow: 'hidden' }}>
      {team?.logoUrl && <img src={team.logoUrl} alt={team.name} referrerPolicy="no-referrer" style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'cover', border: '1px solid var(--border)' }} />}
      <span style={{ fontWeight: 800, fontSize: '0.8rem', textAlign: right ? 'right' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{team?.name}</span>
    </div>
  )
}

// ── Admin score control ───────────────────────────────────
function AdminControl({ label, score, leading, onAdd, onSub, busy, isServing }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <p className="score-panel-name" style={{ color: 'var(--text-2)', fontWeight: 600 }}>{label}</p>
        {isServing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,85,0,0.1)', border: '1px solid rgba(255,85,0,0.25)', borderRadius: 20, padding: '2px 8px' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
            <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Serving</span>
          </div>
        )}
      </div>
      <button aria-label={`Add point for ${label}`} className="btn btn-primary" onClick={onAdd} disabled={busy}
        style={{ width: 58, height: 58, borderRadius: '50%', fontSize: '1.8rem', padding: 0 }}>+</button>
      <span aria-live="polite" aria-label={`${label} score: ${score}`} style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 1, color: leading ? 'var(--text-1)' : 'var(--text-3)', letterSpacing: '-3px', fontVariantNumeric: 'tabular-nums', transition: 'color 200ms ease' }}>
        {score}
      </span>
      <button aria-label={`Subtract point for ${label}`} className="btn btn-secondary" onClick={onSub} disabled={busy || score === 0}
        style={{ width: 44, height: 44, borderRadius: '50%', fontSize: '1.4rem', padding: 0 }}>−</button>
    </div>
  )
}

// ── Read-only score ───────────────────────────────────────
function ReadOnlyScore({ label, score, leading, logo, isServing }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
      {logo && <img src={logo} alt={label} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }} />}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <p className="score-panel-name" style={{ color: 'var(--text-2)', fontWeight: 600 }}>{label}</p>
        {isServing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,85,0,0.1)', border: '1px solid rgba(255,85,0,0.25)', borderRadius: 20, padding: '2px 8px' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
            <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Serving</span>
          </div>
        )}
      </div>
      <span style={{ fontSize: '4.5rem', fontWeight: 900, lineHeight: 1, color: leading ? 'var(--text-1)' : 'var(--text-3)', letterSpacing: '-3px', fontVariantNumeric: 'tabular-nums', transition: 'color 200ms ease' }}>
        {score}
      </span>
    </div>
  )
}

// ── Players list ──────────────────────────────────────────
function PlayersList({ team, players }) {
  const sorted = [...players].sort((a, b) => {
    const order = { Captain: 0, 'Vice Captain': 1, Player: 2 }
    return (order[a.role] ?? 3) - (order[b.role] ?? 3)
  })
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        {team?.logoUrl
          ? <img src={team.logoUrl} alt={team.name} referrerPolicy="no-referrer" style={{ width: 24, height: 24, borderRadius: 5, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} />
          : <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>👥</span>}
        <p style={{ fontWeight: 800, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team?.name}</p>
      </div>
      {sorted.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '0.75rem', padding: '14px 8px' }}>No players</p>}
      {sorted.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderBottom: '1px solid var(--border-light)' }}>
          {p.photoUrl
            ? <img src={p.photoUrl} alt={p.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 800, fontSize: '0.68rem', color: 'var(--accent)' }}>{p.name[0].toUpperCase()}</div>}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <p style={{ fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</p>
            <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
              {p.role !== 'Player' && <RoleBadge role={p.role} />}
              {p.position && <PosBadge pos={p.position} />}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RoleBadge({ role }) {
  const s = ROLE_COLORS[role] || ROLE_COLORS.Player
  return <span style={{ fontSize: '0.52rem', fontWeight: 700, padding: '1px 5px', borderRadius: 20, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{role === 'Captain' ? 'C' : 'VC'}</span>
}
function PosBadge({ pos }) {
  const s = POS_COLORS[pos]; if (!s) return null
  return <span style={{ fontSize: '0.52rem', fontWeight: 700, padding: '1px 5px', borderRadius: 20, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{pos}</span>
}

// ── Lineup picker (before start match) ───────────────────
function LineupPicker({ event, homeTeam, homePlayers, awayTeam, awayPlayers, homeStarting, setHomeStarting, awayStarting, setAwayStarting }) {
  const courtSize = event === 'Quad' ? 4 : 3

  const toggle = (id, starting, setStarting) => {
    if (starting.includes(id)) {
      setStarting(starting.filter(x => x !== id))
    } else if (starting.length < courtSize) {
      setStarting([...starting, id])
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: '0.68rem', color: 'var(--text-3)', fontWeight: 600, marginBottom: 8, textAlign: 'center' }}>
        Select {courtSize} starting players per team
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { team: homeTeam, players: homePlayers, starting: homeStarting, setStarting: setHomeStarting },
          { team: awayTeam, players: awayPlayers, starting: awayStarting, setStarting: setAwayStarting },
        ].map(({ team, players, starting, setStarting }) => (
          <div key={team?.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontWeight: 800, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team?.name}</p>
              <p style={{ fontSize: '0.6rem', color: starting.length >= courtSize ? '#16a34a' : 'var(--accent)', fontWeight: 700 }}>
                {starting.length}/{courtSize} selected
              </p>
            </div>
            {players.length === 0 && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', padding: '12px 10px', textAlign: 'center' }}>No players added</p>
            )}
            {players.map(p => {
              const selected = starting.includes(p.id)
              return (
                <div key={p.id}
                  onClick={() => toggle(p.id, starting, setStarting)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', background: selected ? 'rgba(255,85,0,0.05)' : 'transparent', transition: 'background 120ms' }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, background: selected ? 'var(--accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {selected && <span style={{ color: '#fff', fontSize: '0.55rem', fontWeight: 900 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</p>
                    {(p.role !== 'Player' || p.position) && (
                      <p style={{ fontSize: '0.58rem', color: 'var(--text-3)' }}>{[p.role !== 'Player' ? p.role : null, p.position].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sub / Re-entry modal ──────────────────────────────────
function SubReentryModal({ type, lineup, teamName, onConfirm, onCancel }) {
  const [outId, setOutId] = useState(null)
  const [inId,  setInId]  = useState(null)

  const playing = lineup.filter(p => p.status === 'playing')
  const bench   = lineup.filter(p => p.status === 'bench')
  const canConfirm = outId && inId

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
      onClick={onCancel}>
      <div style={{ width: '100%', background: 'var(--bg-base)', borderRadius: '20px 20px 0 0', padding: '20px 16px 36px', maxHeight: '80dvh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <p style={{ fontWeight: 900, fontSize: '1rem' }}>{type === 'sub' ? '🔄 Substitution' : '↩️ Re-entry'}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{teamName}</p>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: 'var(--text-3)' }}>✕</button>
        </div>

        {/* OUT — pick from playing */}
        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
          Player Going OUT (currently playing)
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {playing.map(p => (
            <div key={p.id} onClick={() => setOutId(outId === p.id ? null : p.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `2px solid ${outId === p.id ? '#dc2626' : 'var(--border)'}`, background: outId === p.id ? 'rgba(239,68,68,0.06)' : 'var(--bg-card)', cursor: 'pointer', transition: 'all 150ms' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.72rem', color: '#dc2626', flexShrink: 0 }}>
                {p.name[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: '0.85rem' }}>{p.name}</p>
                {(p.role !== 'Player' || p.position) && <p style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>{[p.role !== 'Player' ? p.role : null, p.position].filter(Boolean).join(' · ')}</p>}
              </div>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#16a34a' }}>ON COURT</span>
            </div>
          ))}
        </div>

        {/* IN — pick from bench */}
        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
          Player Coming IN (from bench)
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {bench.length === 0 && <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', textAlign: 'center', padding: '12px 0' }}>No bench players</p>}
          {bench.map(p => (
            <div key={p.id} onClick={() => setInId(inId === p.id ? null : p.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `2px solid ${inId === p.id ? '#16a34a' : 'var(--border)'}`, background: inId === p.id ? 'rgba(34,197,94,0.06)' : 'var(--bg-card)', cursor: 'pointer', transition: 'all 150ms' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(34,197,94,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.72rem', color: '#16a34a', flexShrink: 0 }}>
                {p.name[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: '0.85rem' }}>{p.name}</p>
                {(p.role !== 'Player' || p.position) && <p style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>{[p.role !== 'Player' ? p.role : null, p.position].filter(Boolean).join(' · ')}</p>}
              </div>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-3)' }}>BENCH</span>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" onClick={() => canConfirm && onConfirm({ outId, inId })}
          disabled={!canConfirm}
          style={{ width: '100%', height: 48, fontSize: '0.95rem', opacity: canConfirm ? 1 : 0.45 }}>
          Confirm {type === 'sub' ? 'Substitution' : 'Re-entry'}
        </button>
      </div>
    </div>
  )
}

// ── Lineup display (visible to all during match) ──────────
function LineupDisplay({ lineup, homeTeam, awayTeam }) {
  const homePlay  = lineup.home?.filter(p => p.status === 'playing') || []
  const homeBench = lineup.home?.filter(p => p.status === 'bench')   || []
  const awayPlay  = lineup.away?.filter(p => p.status === 'playing') || []
  const awayBench = lineup.away?.filter(p => p.status === 'bench')   || []

  return (
    <div className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontWeight: 800, fontSize: '0.78rem' }}>👕 Match Lineup</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {[
          { team: homeTeam, playing: homePlay, bench: homeBench },
          { team: awayTeam, playing: awayPlay, bench: awayBench },
        ].map(({ team, playing, bench }, ti) => (
          <div key={ti} style={{ borderRight: ti === 0 ? '1px solid var(--border)' : 'none', padding: '10px 10px' }}>
            <p style={{ fontWeight: 800, fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8, color: 'var(--text-2)' }}>{team?.name}</p>

            {/* Playing */}
            {playing.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,85,0,0.1)', border: '1.5px solid rgba(255,85,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.6rem', color: 'var(--accent)' }}>
                    {p.name[0]?.toUpperCase()}
                  </div>
                  {p.event === 'subIn'   && <span style={{ position: 'absolute', bottom: -4, right: -4, fontSize: '0.6rem', lineHeight: 1 }}>🟢</span>}
                  {p.event === 'reentry' && <span style={{ position: 'absolute', bottom: -4, right: -4, fontSize: '0.6rem', lineHeight: 1 }}>↩️</span>}
                </div>
                <div style={{ overflow: 'hidden', minWidth: 0 }}>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</p>
                  {p.position && <p style={{ fontSize: '0.55rem', color: 'var(--text-3)' }}>{p.position}</p>}
                </div>
              </div>
            ))}

            {/* Bench */}
            {bench.length > 0 && (
              <>
                <p style={{ fontSize: '0.55rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 8, marginBottom: 4 }}>Bench</p>
                {bench.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, opacity: p.event === 'subOut' ? 1 : 0.5 }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.55rem', color: 'var(--text-3)' }}>
                        {p.name[0]?.toUpperCase()}
                      </div>
                      {p.event === 'subOut' && <span style={{ position: 'absolute', bottom: -4, right: -4, fontSize: '0.6rem', lineHeight: 1 }}>🔴</span>}
                    </div>
                    <p style={{ fontSize: '0.68rem', color: p.event === 'subOut' ? 'var(--text-1)' : 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: p.event === 'subOut' ? 600 : 400 }}>{p.name}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Generic page — shows all live matches to pick from ────
function GenericScoring() {
  const navigate = useNavigate()
  const [leagues,      setLeagues]      = useState([])
  const [liveMatches,  setLiveMatches]  = useState([]) // { fixture, leagueId, leagueName }
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    return onSnapshot(
      collection(db, 'leagues'),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        all.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        setLeagues(all.filter(l => l.status === 'active' || l.status === 'upcoming'))
        setLoading(false)
      }
    )
  }, [])

  useEffect(() => {
    if (leagues.length === 0) return
    const unsubs = leagues.map(league =>
      onSnapshot(
        collection(db, 'leagues', league.id, 'fixtures'),
        snap => {
          const live = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(f => f.status === 'live')
            .map(f => ({ fixture: f, leagueId: league.id, leagueName: league.name }))
          setLiveMatches(prev => {
            const others = prev.filter(m => m.leagueId !== league.id)
            return [...others, ...live]
          })
        }
      )
    )
    return () => unsubs.forEach(u => u())
  }, [leagues.map(l => l.id).join(',')])

  return (
    <div className="page">
      <p className="page-subtitle">Live Scoring</p>
      <h1 className="page-title" style={{ marginBottom: 20 }}>Select a Match</h1>

      {loading ? (
        <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '32px 0' }}>Loading…</p>
      ) : liveMatches.length > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            <p style={{ fontSize: '0.72rem', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {liveMatches.length} Match{liveMatches.length > 1 ? 'es' : ''} Live Now
            </p>
          </div>
          {liveMatches.map(({ fixture: f, leagueId, leagueName }) => (
            <div key={f.id} className="card"
              onClick={() => navigate(`/scoring/${leagueId}/${f.id}`)}
              style={{ border: '1px solid rgba(34,197,94,0.35)', marginBottom: 12, cursor: 'pointer', padding: 0, overflow: 'hidden' }}>
              <div style={{ height: 3, background: 'linear-gradient(90deg,#22c55e,#16a34a)' }} />
              <div style={{ padding: '12px 14px' }}>
                {/* League + event */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-3)' }}>{leagueName}</span>
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,85,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,85,0,0.15)' }}>
                    {f.event === 'Regu' ? '👟' : '🏐'} {f.event} · L{f.leg}
                  </span>
                </div>
                {/* Teams + score */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <LiveTeamBlock team={f.homeTeam} align="right" />
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '8px 14px', textAlign: 'center', flexShrink: 0 }}>
                    <p style={{ fontWeight: 900, fontSize: '1.2rem', color: '#16a34a', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {(f.sets || []).filter(s => s.winner === 'home').length} – {(f.sets || []).filter(s => s.winner === 'away').length}
                    </p>
                    <p style={{ fontSize: '0.52rem', color: 'var(--text-3)', fontWeight: 600, marginTop: 3 }}>SETS</p>
                  </div>
                  <LiveTeamBlock team={f.awayTeam} align="left" />
                </div>
                <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#16a34a', fontWeight: 600, marginTop: 10 }}>
                  Tap to watch →
                </p>
              </div>
            </div>
          ))}
        </>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <p style={{ fontSize: '2rem', marginBottom: 8 }}>🏐</p>
          <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 6 }}>No live matches right now</p>
          <p style={{ color: 'var(--text-2)', fontSize: '0.82rem', maxWidth: 260, margin: '0 auto 16px' }}>
            Matches will appear here once they go live. Check Fixtures for the schedule.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/fixtures')}
            style={{ height: 40, padding: '0 20px', fontSize: '0.85rem' }}>
            View Fixtures
          </button>
        </div>
      )}
    </div>
  )
}

function ViewerSubAlert({ subAlert }) {
  const [visible, setVisible] = useState(false)
  const [lastAt, setLastAt]   = useState(null)

  useEffect(() => {
    if (!subAlert?.at || subAlert.at === lastAt) return
    setLastAt(subAlert.at)
    setVisible(true)
    const id = setTimeout(() => setVisible(false), 4000)
    return () => clearTimeout(id)
  }, [subAlert?.at])

  if (!visible) return null

  const isReentry = subAlert.type === 'reentry'
  const icon      = isReentry ? '↩️' : '🔄'
  const label     = isReentry ? 'Re-entry' : 'Substitution'
  const color     = isReentry ? '#6366f1' : '#16a34a'
  const borderCol = isReentry ? 'rgba(99,102,241,0.35)' : 'rgba(34,197,94,0.35)'

  return (
    <div style={{
      position: 'fixed', bottom: 90, left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 200, width: 'calc(100% - 32px)', maxWidth: 360,
      background: '#1a1a2e',
      borderRadius: 16, padding: '14px 16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      border: `1px solid ${borderCol}`,
      animation: 'slideUp 280ms cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}22`, border: `1px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>
            {label} — {subAlert.teamName}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{subAlert.outName}</span>
            <span style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 800 }}>↓</span>
            <span style={{ fontSize: '0.7rem', color: '#22c55e', fontWeight: 800 }}>↑</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{subAlert.inName}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ViewerTimeoutPill({ timeoutActive, homeTeam, awayTeam }) {
  const [remaining, setRemaining] = useState(null)

  useEffect(() => {
    if (!timeoutActive?.startedAt) return
    const tick = () => {
      const elapsed = Math.floor((Date.now() - timeoutActive.startedAt) / 1000)
      const left = Math.max(0, TIMEOUT_SEC - elapsed)
      setRemaining(left)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timeoutActive?.startedAt])

  if (remaining === null || remaining <= 0) return null

  const teamName = timeoutActive.side === 'home' ? homeTeam : awayTeam
  const pct = (remaining / TIMEOUT_SEC) * 100

  return (
    <div style={{
      position: 'fixed', top: 72, right: 12, zIndex: 200,
      background: '#1a1a2e', borderRadius: 14,
      padding: '8px 12px', minWidth: 120,
      boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
      border: '1px solid rgba(245,158,11,0.35)',
      animation: 'slideDown 250ms ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <span style={{ fontSize: '0.8rem' }}>⏱</span>
        <div>
          <p style={{ fontSize: '0.6rem', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Timeout</p>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{teamName}</p>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct > 30 ? '#f59e0b' : '#ef4444', borderRadius: 2, transition: 'width 1s linear' }} />
      </div>
      <p style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.1rem', color: pct > 30 ? '#f59e0b' : '#ef4444', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {remaining}s
      </p>
    </div>
  )
}

function LiveTeamBlock({ team, align }) {
  if (!team) return <div style={{ flex: 1 }} />
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', overflow: 'hidden' }}>
      {align === 'right' && <span style={{ fontWeight: 700, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>}
      {team.logoUrl
        ? <img src={team.logoUrl} alt={team.name} referrerPolicy="no-referrer" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} />
        : <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>👥</div>}
      {align === 'left' && <span style={{ fontWeight: 700, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────
const BackIcon    = () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
const PlayersIcon = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
const EyeIcon     = () => <svg width="16" height="16" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
