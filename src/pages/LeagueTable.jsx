import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useLeagues } from '../context/LeaguesContext'
import { useSupportedTeam } from '../hooks/useSupportedTeam'
import { useToast } from '../hooks/useToast'
import { useRecalcTable } from '../hooks/useRecalcTable'

const POS_STYLE = {
  1: { color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  2: { color: '#4b5563', bg: '#f3f4f6', border: '#d1d5db' },
  3: { color: '#92400e', bg: '#fdf4ea', border: '#fcd9a8' },
}

const EVENT_ICON = { Regu: '👟', Quad: '🏐' }

export default function LeagueTable() {
  const { isAdmin } = useAuth()
  const { supportedTeam, supportTeam } = useSupportedTeam()
  const { leagues, loading } = useLeagues()

  const [selectedLeague, setSelectedLeague] = useState(null)
  const [teams, setTeams]             = useState([])
  const [fixtures, setFixtures]       = useState([])
  const [activeEvent, setActiveEvent] = useState(null)
  const [supportCounts, setSupportCounts] = useState({}) // { teamId: count }
  const [recalcBusy, setRecalcBusy]       = useState(false)
  const [recalcDone, setRecalcDone]       = useState(false)
  const { toast, showToast } = useToast()
  const { recalc } = useRecalcTable()

  // Sync selectedLeague when leagues arrive or change
  useEffect(() => {
    if (leagues.length === 0) return
    setSelectedLeague(prev => {
      if (prev && leagues.find(l => l.id === prev.id)) return leagues.find(l => l.id === prev.id)
      const pinned = sessionStorage.getItem('selectedLeagueId')
      if (pinned) { sessionStorage.removeItem('selectedLeagueId'); return leagues.find(l => l.id === pinned) || leagues.find(l => l.status === 'active') || leagues[0] || null }
      return leagues.find(l => l.status === 'active') || leagues[0] || null
    })
  }, [leagues])

  // When selected league changes, set default event tab
  useEffect(() => {
    if (!selectedLeague) return
    const events = selectedLeague.events || []
    setActiveEvent(events.length > 1 ? 'Overview' : events[0] || null)
  }, [selectedLeague?.id])

  // Load teams for selected league
  useEffect(() => {
    if (!selectedLeague) { setTeams([]); return }
    return onSnapshot(
      collection(db, 'leagues', selectedLeague.id, 'teams'),
      snap => setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [selectedLeague?.id])

  // Load fixtures to detect if league is complete
  useEffect(() => {
    if (!selectedLeague) { setFixtures([]); return }
    return onSnapshot(
      collection(db, 'leagues', selectedLeague.id, 'fixtures'),
      snap => setFixtures(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [selectedLeague?.id])

  // Live supporter counts from userTeams collection
  useEffect(() => {
    return onSnapshot(collection(db, 'userTeams'), snap => {
      const counts = {}
      snap.docs.forEach(d => {
        const teamId = d.data().teamId
        if (teamId) counts[teamId] = (counts[teamId] || 0) + 1
      })
      setSupportCounts(counts)
    })
  }, [])

  const events = selectedLeague?.events || []
  const showEventTabs = events.length > 1

  // Read event-specific stats for a team (Overview combines all events)
  const getStats = (team) => {
    if (activeEvent === 'Overview') {
      const evList = selectedLeague?.events || []
      return evList.reduce((acc, ev) => {
        const s = team.eventStats?.[ev] || {}
        return {
          p:          acc.p          + (s.p          || 0),
          w:          acc.w          + (s.w          || 0),
          l:          acc.l          + (s.l          || 0),
          pts:        acc.pts        + (s.pts        || 0),
          setsWon:    acc.setsWon    + (s.setsWon    || 0),
          setsLost:   acc.setsLost   + (s.setsLost   || 0),
          ptsFor:     acc.ptsFor     + (s.ptsFor     || 0),
          ptsAgainst: acc.ptsAgainst + (s.ptsAgainst || 0),
        }
      }, { p: 0, w: 0, l: 0, pts: 0, setsWon: 0, setsLost: 0, ptsFor: 0, ptsAgainst: 0 })
    }
    const s = activeEvent ? (team.eventStats?.[activeEvent] || {}) : {}
    return {
      p:          s.p          || 0,
      w:          s.w          || 0,
      l:          s.l          || 0,
      pts:        s.pts        || 0,
      setsWon:    s.setsWon    || 0,
      setsLost:   s.setsLost   || 0,
      ptsFor:     s.ptsFor     || 0,
      ptsAgainst: s.ptsAgainst || 0,
    }
  }

  // Sort: league pts → wins → sets diff → points diff
  const sortedTeams = [...teams].sort((a, b) => {
    const sa = getStats(a), sb = getStats(b)
    const ptsDiff = sb.pts - sa.pts;                           if (ptsDiff !== 0) return ptsDiff
    const wDiff   = sb.w   - sa.w;                            if (wDiff   !== 0) return wDiff
    const sDiff   = (sb.setsWon - sb.setsLost) - (sa.setsWon - sa.setsLost); if (sDiff !== 0) return sDiff
    return (sb.ptsFor - sb.ptsAgainst) - (sa.ptsFor - sa.ptsAgainst)
  })

  // Determine if all matches for each event are done → reveal winner
  const isEventComplete = (event) => {
    const eventFixtures = event === 'Overview'
      ? fixtures
      : fixtures.filter(f => !event || f.event === event)
    return eventFixtures.length > 0 && eventFixtures.every(f => f.status === 'completed')
  }
  const currentEventComplete = isEventComplete(activeEvent)

  const recalcTable = async () => {
    if (!selectedLeague || !isAdmin || recalcBusy) return
    setRecalcBusy(true)
    setRecalcDone(false)
    try {
      await recalc(selectedLeague.id)
      setRecalcDone(true)
      setTimeout(() => setRecalcDone(false), 3000)
    } catch (err) {
      console.error('Recalc failed:', err)
      showToast('Recalculation failed. Some stats may be incomplete — try again.')
    } finally {
      setRecalcBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header" style={{ marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ width: 120, height: 10, borderRadius: 4, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: 160, height: 22, borderRadius: 6 }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[80, 80].map((w, i) => <div key={i} className="skeleton" style={{ width: w, height: 32, borderRadius: 20 }} />)}
        </div>
        <div className="card" style={{ padding: '12px 10px' }}>
          <div style={{ height: 1, background: 'var(--border)', marginBottom: 8 }} />
          {[0,1,2,3,4].map(i => (
            <div key={i} className="league-table-grid" style={{ padding: '8px 0' }}>
              <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 4 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="skeleton" style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0 }} />
                <div className="skeleton" style={{ width: '65%', height: 12, borderRadius: 4 }} />
              </div>
              {[0,1,2,3,4,5,6].map(j => (
                <div key={j} className="skeleton" style={{ height: 12, borderRadius: 4 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (leagues.length === 0) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <p className="page-subtitle">Chennai Sepak Takraw</p>
            <h1 className="page-title">League Table</h1>
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: '2.5rem', marginBottom: 12 }}>🏆</p>
          <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 6 }}>No leagues yet</p>
          <p style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>
            {isAdmin ? 'Go to the Leagues tab to create one.' : 'Check back once the admin creates a league.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">

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

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <p className="page-subtitle">{selectedLeague?.name || 'Chennai Sepak Takraw'}</p>
          <h1 className="page-title">League Table {selectedLeague?.year ? `· ${selectedLeague.year}` : ''}</h1>
        </div>
        {selectedLeague?.status === 'active' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, background: 'rgba(34,197,94,0.1)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.25)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            Live
          </span>
        )}
      </div>

      {/* League selector — shown if more than one league exists */}
      {leagues.length > 1 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 14, scrollbarWidth: 'none' }}>
          {leagues.map(l => {
            const sel = selectedLeague?.id === l.id
            return (
              <button key={l.id} onClick={() => setSelectedLeague(l)}
                style={{ flexShrink: 0, height: 36, padding: '0 14px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.78rem', background: sel ? 'var(--accent)' : 'var(--bg-card)', color: sel ? '#fff' : 'var(--text-2)', border: sel ? '1.5px solid var(--accent)' : '1.5px solid var(--border)', transition: 'all 150ms ease', boxShadow: sel ? '0 2px 8px rgba(255,85,0,0.2)' : 'none' }}>
                {l.name} {l.year ? `'${String(l.year).slice(-2)}` : ''}
                {l.status === 'active' && <span style={{ marginLeft: 5 }}>●</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* League meta strip */}
      {selectedLeague && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingLeft: 2 }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>
            {selectedLeague.startDate}{selectedLeague.endDate ? ` → ${selectedLeague.endDate}` : ''}
          </p>
          <div style={{ display: 'flex', gap: 5 }}>
            {events.map(ev => (
              <span key={ev} style={{ padding: '2px 8px', borderRadius: 20, fontSize: '0.62rem', fontWeight: 700, background: 'rgba(255,85,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,85,0,0.2)' }}>
                {EVENT_ICON[ev]} {ev}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Event tabs — only shown when league has both Regu & Quad */}
      {showEventTabs && (
        <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 12, padding: 4, marginBottom: 16, gap: 4 }}>
          {['Overview', ...events].map(ev => {
            const sel = activeEvent === ev
            return (
              <button key={ev} onClick={() => setActiveEvent(ev)}
                style={{ flex: 1, height: 40, borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.78rem', background: sel ? 'var(--bg-card)' : 'transparent', color: sel ? 'var(--accent)' : 'var(--text-2)', boxShadow: sel ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 150ms ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                {ev === 'Overview' ? '📊' : EVENT_ICON[ev]} {ev === 'Overview' ? 'Overall' : ev}
              </button>
            )
          })}
        </div>
      )}

      {/* Admin: Recalculate Table */}
      {isAdmin && teams.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={recalcTable} disabled={recalcBusy}
            style={{ width: '100%', height: 40, borderRadius: 10, border: `1.5px solid ${recalcDone ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`, background: recalcDone ? 'rgba(34,197,94,0.06)' : 'var(--bg-elevated)', color: recalcDone ? '#16a34a' : 'var(--text-2)', fontWeight: 700, fontSize: '0.8rem', cursor: recalcBusy ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {recalcBusy ? '⟳ Recalculating…' : recalcDone ? '✓ Table Recalculated' : '⟳ Recalculate Table'}
          </button>
        </div>
      )}

      {/* Support hint */}
      {!isAdmin && teams.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <span style={{ fontSize: '1rem' }}>❤️</span>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>Tap the heart to support your team</p>
        </div>
      )}

      {/* No teams yet */}
      {teams.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '36px 16px' }}>
          <p style={{ fontSize: '2rem', marginBottom: 10 }}>👥</p>
          <p style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 6 }}>No teams yet</p>
          <p style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>
            {isAdmin ? 'Go to Leagues → Manage to add teams.' : 'Teams will appear here once added.'}
          </p>
        </div>
      )}

      {/* Winner banner — shown when all matches in the event are completed */}
      {currentEventComplete && sortedTeams.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg,#b45309 0%,#f59e0b 60%,#fde68a 100%)', borderRadius: 16, padding: '20px 20px', marginBottom: 16, textAlign: 'center', boxShadow: '0 4px 20px rgba(180,83,9,0.25)' }}>
          <p style={{ fontSize: '2rem', marginBottom: 6 }}>🏆</p>
          <p style={{ fontWeight: 900, fontSize: '1.1rem', color: '#fff', marginBottom: 2 }}>
            {sortedTeams[0].name}
          </p>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
            {activeEvent ? `${EVENT_ICON[activeEvent]} ${activeEvent} Champion` : 'League Champion'} {selectedLeague?.year ? `· ${selectedLeague.year}` : ''}
          </p>
        </div>
      )}

      {/* Table */}
      {sortedTeams.length > 0 && (
        <>
          {/* Column headers */}
          <div className="league-table-grid" style={{ padding: '0 10px 8px' }}>
            {['#', 'Team', 'P', 'W', 'L', 'PD', 'Sets', 'Pts', ''].map((h, i) => (
              <span key={i} title={['','','Played','Wins','Losses','Points Difference','Sets Won–Lost','League Points',''][i]}
                style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: h === 'Pts' ? 'var(--accent)' : 'var(--text-3)', textAlign: i === 1 ? 'left' : 'center' }}>
                {h}
              </span>
            ))}
          </div>

          {sortedTeams.map((team, idx) => {
            const pos = idx + 1
            const ps  = POS_STYLE[pos] || {}
            const isSupported = supportedTeam === team.id

            const { p, w, l, pts, setsWon, setsLost, ptsFor, ptsAgainst } = getStats(team)
            const pd       = ptsFor - ptsAgainst
            const netSets  = setsWon - setsLost
            const setsStr  = netSets > 0 ? `+${netSets}` : `${netSets}`
            const pdStr    = pd > 0 ? `+${pd}` : `${pd}`

            return (
              <div key={team.id} className="card" style={{
                padding: '11px 10px', marginBottom: 8,
                border: isSupported ? '1px solid rgba(255,85,0,0.4)' : pos === 1 ? '1px solid #fde68a' : '1px solid var(--border)',
                background: isSupported ? 'linear-gradient(135deg,#fff8f5 0%,#fff3ee 100%)' : pos === 1 ? '#fffbeb' : 'var(--bg-card)',
              }}>
                <div className="league-table-grid">

                  {/* Position */}
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: currentEventComplete && pos === 1 ? 'linear-gradient(135deg,#b45309,#f59e0b)' : ps.bg || 'var(--bg-elevated)', border: `1px solid ${currentEventComplete && pos === 1 ? '#f59e0b' : ps.border || 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: currentEventComplete && pos === 1 ? '0.75rem' : '0.65rem', fontWeight: 800, color: currentEventComplete && pos === 1 ? '#fff' : ps.color || 'var(--text-3)', flexShrink: 0 }}>
                    {currentEventComplete && pos === 1 ? '👑' : pos}
                  </div>

                  {/* Team name + logo */}
                  <div className="team-name-cell" style={{ paddingLeft: 1 }}>
                    {team.logoUrl ? (
                      <img src={team.logoUrl} alt={team.name} referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
                    ) : (
                      <div style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.7rem' }}>👥</div>
                    )}
                    <div style={{ overflow: 'hidden', minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{team.name}</span>
                      {isSupported && <span style={{ fontSize: '0.6rem', color: 'var(--accent)', fontWeight: 700 }}>My Team</span>}
                    </div>
                  </div>

                  {/* P, W, L */}
                  {[p, w, l].map((v, i) => (
                    <span key={i} style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                  ))}

                  {/* Points Difference */}
                  <span style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.88rem', fontVariantNumeric: 'tabular-nums', color: pd > 0 ? '#16a34a' : pd < 0 ? '#dc2626' : 'var(--text-3)' }}>
                    {pdStr}
                  </span>

                  {/* Net Sets */}
                  <span style={{ textAlign: 'center', fontSize: '0.88rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: netSets > 0 ? '#16a34a' : netSets < 0 ? '#dc2626' : 'var(--text-3)' }}>
                    {setsStr}
                  </span>

                  {/* League Pts */}
                  <span style={{ textAlign: 'center', fontWeight: 900, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums', color: pts > 0 ? 'var(--accent)' : 'var(--text-3)' }}>
                    {pts}
                  </span>

                  {/* Heart + count */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                    {!isAdmin ? (
                      <button onClick={() => supportTeam(team.id)} aria-label={`Support ${team.name}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', transition: 'transform 150ms ease', padding: 0 }}
                        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.85)'}
                        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                        onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}>
                        <HeartIcon filled={isSupported} />
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.85rem' }}>❤️</span>
                    )}
                    {(supportCounts[team.id] || 0) > 0 && (
                      <span style={{ fontSize: '0.58rem', fontWeight: 800, color: isSupported ? 'var(--accent)' : 'var(--text-3)', lineHeight: 1 }}>
                        {supportCounts[team.id]}
                      </span>
                    )}
                  </div>

                </div>
              </div>
            )
          })}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, padding: '4px 2px', marginTop: 4 }}>
            {[{ color: '#b45309', label: '1st' }, { color: '#4b5563', label: '2nd' }, { color: '#92400e', label: '3rd' }].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: '0.68rem', color: 'var(--text-3)', fontWeight: 600 }}>{label}</span>
              </div>
            ))}
          </div>
        </>
      )}


    </div>
  )
}

function HeartIcon({ filled }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? '#ff5500' : 'none'}
      stroke={filled ? '#ff5500' : '#b0b8c4'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  )
}
