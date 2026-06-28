import { useState, useEffect } from 'react'
import Spinner from '../components/Spinner'
import { useNavigate, Link } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, doc,
  updateDoc, deleteDoc, getDocs, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from '../hooks/useToast'

const STATUS_STYLES = {
  active:    { bg: 'rgba(34,197,94,0.1)',  color: '#16a34a', border: 'rgba(34,197,94,0.25)',  label: 'Active'    },
  upcoming:  { bg: 'rgba(255,85,0,0.08)',  color: '#ff5500', border: 'rgba(255,85,0,0.2)',    label: 'Upcoming'  },
  completed: { bg: 'rgba(107,114,128,0.1)',color: '#6b7280', border: 'rgba(107,114,128,0.2)', label: 'Completed' },
}

export default function ManageLeagues() {
  const navigate = useNavigate()
  const [leagues, setLeagues]     = useState([])
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [form, setForm]           = useState({ name: '', year: new Date().getFullYear().toString(), startDate: '', endDate: '', status: 'upcoming', events: [] })
  const [errors, setErrors]       = useState({})
  const { toast, showToast } = useToast()

  // Live leagues from Firestore
  useEffect(() => {
    return onSnapshot(collection(db, 'leagues'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      setLeagues(all)
    })
  }, [])

  const toggleEvent = (event) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter(e => e !== event)
        : [...f.events, event],
    }))
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim())      e.name = 'League name is required'
    if (!form.year.trim())      e.year = 'Year is required'
    if (!form.startDate)        e.startDate = 'Start date is required'
    if (form.events.length === 0) e.events = 'Select at least one event'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'leagues'), {
        name:      form.name.trim(),
        year:      form.year.trim(),
        startDate: form.startDate,
        endDate:   form.endDate || null,
        status:    form.status,
        events:    form.events,
        createdAt: serverTimestamp(),
      })
      setForm({ name: '', year: new Date().getFullYear().toString(), startDate: '', endDate: '', status: 'upcoming', events: [] })
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  const setActive = async (leagueId) => {
    const l = leagues.find(x => x.id === leagueId)
    if (!l) return
    try {
      await updateDoc(doc(db, 'leagues', leagueId), {
        status: l.status === 'active' ? 'upcoming' : 'active',
      })
    } catch (err) {
      console.error('Status update failed:', err)
      showToast('Failed to update league status. Try again.')
    }
  }

  const deleteLeague = async (leagueId) => {
    if (deleting) return
    setDeleting(true)
    try {
      // Delete all players inside each team, then teams, then the league
      const teamsSnap = await getDocs(collection(db, 'leagues', leagueId, 'teams'))
      for (const teamDoc of teamsSnap.docs) {
        const playersSnap = await getDocs(collection(db, 'leagues', leagueId, 'teams', teamDoc.id, 'players'))
        for (const playerDoc of playersSnap.docs) await deleteDoc(playerDoc.ref)
        await deleteDoc(teamDoc.ref)
      }
      await deleteDoc(doc(db, 'leagues', leagueId))
    } catch (err) {
      console.error('Delete failed:', err)
      showToast('Delete failed. Some data may remain — try again.')
    } finally {
      setDeleting(false)
    }
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
      <div className="page-header">
        <div>
          <p className="page-subtitle">Admin Panel</p>
          <h1 className="page-title">Manage Leagues</h1>
        </div>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, color: 'var(--text-2)' }}
          aria-label="Go back"
        >
          <BackIcon />
        </button>
      </div>

      {/* Create button */}
      {!showForm && (
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(true)}
          style={{ width: '100%', height: 50, fontSize: '0.95rem', gap: 8, marginBottom: 20 }}
        >
          <PlusIcon />
          Create New League
        </button>
      )}

      {/* Create form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(255,85,0,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ fontWeight: 800, fontSize: '1rem' }}>New League</p>
            <button onClick={() => { setShowForm(false); setErrors({}) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: '1.1rem' }}>✕</button>
          </div>

          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <Field label="League Name *" error={errors.name}>
              <input
                style={inputStyle(errors.name)}
                placeholder="e.g. Chennai Sepak Takraw League 2025"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Year *" error={errors.year}>
                <input
                  style={inputStyle(errors.year)}
                  placeholder="2025"
                  value={form.year}
                  onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                  type="number" min="2020" max="2099"
                />
              </Field>

              <Field label="Status">
                <select
                  style={{ ...inputStyle(), cursor: 'pointer' }}
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Start Date *" error={errors.startDate}>
                <input
                  style={inputStyle(errors.startDate)}
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </Field>
              <Field label="End Date">
                <input
                  style={inputStyle()}
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                />
              </Field>
            </div>

            {/* Events */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                Events *
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                {['Regu', 'Quad'].map(ev => {
                  const selected = form.events.includes(ev)
                  return (
                    <button
                      key={ev} type="button"
                      onClick={() => toggleEvent(ev)}
                      style={{
                        flex: 1, height: 52, borderRadius: 10, border: 'none',
                        cursor: 'pointer', fontFamily: 'inherit',
                        fontWeight: 700, fontSize: '0.95rem',
                        background: selected ? 'var(--accent)' : 'var(--bg-elevated)',
                        color: selected ? '#fff' : 'var(--text-2)',
                        border: selected ? '2px solid var(--accent)' : '2px solid var(--border)',
                        boxShadow: selected ? '0 2px 12px rgba(255,85,0,0.25)' : 'none',
                        transition: 'all 150ms ease',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                      }}
                    >
                      <span style={{ fontSize: '1.1rem' }}>{ev === 'Regu' ? '👟' : '🏐'}</span>
                      <span>{ev}</span>
                    </button>
                  )
                })}
              </div>
              {errors.events && <p style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>{errors.events}</p>}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setErrors({}) }}
                style={{ flex: 1, height: 46 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}
                style={{ flex: 2, height: 46, fontSize: '0.92rem' }}>
                {saving ? <><Spinner /> Creating…</> : 'Create League'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* League list */}
      {leagues.length === 0 && !showForm && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 16px' }}>
          <p style={{ fontSize: '2rem', marginBottom: 12 }}>🏆</p>
          <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 6 }}>No leagues yet</p>
          <p style={{ color: 'var(--text-2)', fontSize: '0.85rem' }}>Create your first league to get started.</p>
        </div>
      )}

      {leagues.map(league => (
        <LeagueCard key={league.id} league={league} onSetActive={setActive} onDelete={deleteLeague} />
      ))}

    </div>
  )
}

function LeagueCard({ league, onSetActive, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [activating, setActivating] = useState(false)
  const s = STATUS_STYLES[league.status] || STATUS_STYLES.upcoming

  const handleDelete = async () => {
    setDeleting(true)
    await onDelete(league.id)
  }

  const handleSetActive = async () => {
    setActivating(true)
    try { await onSetActive(league.id) } finally { setActivating(false) }
  }

  return (
    <div className="card" style={{
      marginBottom: 10,
      border: league.status === 'active' ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)',
      background: league.status === 'active' ? '#f0fdf4' : 'var(--bg-card)',
    }}>
      {league.status === 'active' && (
        <div style={{ height: 3, background: 'linear-gradient(90deg, #22c55e, #16a34a)', margin: '-16px -16px 14px', borderRadius: '14px 14px 0 0' }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ flex: 1, paddingRight: 10 }}>
          <p style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>{league.name}</p>
          <p style={{ color: 'var(--text-2)', fontSize: '0.78rem', marginBottom: 6 }}>
            {league.startDate}{league.endDate ? ` → ${league.endDate}` : ''}
          </p>
          {(league.events || []).length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              {league.events.map(ev => (
                <span key={ev} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, background: 'rgba(255,85,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,85,0,0.2)' }}>
                  {ev === 'Regu' ? '👟' : '🏐'} {ev}
                </span>
              ))}
            </div>
          )}
        </div>
        <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap' }}>
          {s.label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <button
          onClick={handleSetActive}
          disabled={activating}
          className="btn btn-secondary"
          style={{ flex: 1, height: 38, fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...(league.status === 'active' ? { background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', color: '#16a34a' } : {}) }}>
          {activating ? <><Spinner dark /> Working…</> : league.status === 'active' ? '● Active — tap to deactivate' : 'Set Active'}
        </button>
        <Link to={`/admin/leagues/${league.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 38, padding: '0 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: '0.8rem', textDecoration: 'none', boxShadow: '0 2px 8px rgba(255,85,0,0.25)' }}>
          Manage →
        </Link>
        {confirmDel ? (
          <button onClick={handleDelete} disabled={deleting} style={{ height: 38, padding: '0 12px', borderRadius: 8, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
            {deleting ? <><Spinner /> Deleting…</> : 'Confirm Delete'}
          </button>
        ) : (
          <button onClick={() => setConfirmDel(true)} style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', flexShrink: 0 }}>
            <TrashIcon />
          </button>
        )}
      </div>

      {confirmDel && !deleting && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 8 }}>
          <p style={{ fontSize: '0.78rem', color: '#dc2626', fontWeight: 700, marginBottom: 4 }}>Delete "{league.name}"?</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>This will permanently delete the league, all teams, and all players. This cannot be undone.</p>
          <button onClick={() => setConfirmDel(false)} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-2)', fontFamily: 'inherit', padding: 0 }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  )
}

function Field({ label, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
        {label}
      </label>
      {children}
      {error && <p style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>{error}</p>}
    </div>
  )
}

const inputStyle = (error) => ({
  width: '100%', height: 46,
  background: 'var(--bg-elevated)',
  border: `1px solid ${error ? '#dc2626' : 'var(--border)'}`,
  borderRadius: 8, padding: '0 12px',
  fontSize: '0.92rem', color: 'var(--text-1)',
  fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
})

function PlusIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}
