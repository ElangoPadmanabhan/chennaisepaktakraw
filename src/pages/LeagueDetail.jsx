import { useState, useEffect, useRef } from 'react'
import Spinner from '../components/Spinner'
import { useParams, useNavigate } from 'react-router-dom'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  doc, getDoc, updateDoc, collection,
  addDoc, onSnapshot, deleteDoc, serverTimestamp,
  getDocs, writeBatch, setDoc,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'

const STATUS_OPTIONS = ['upcoming', 'active', 'completed']
const STATUS_STYLES = {
  active:    { bg: 'rgba(34,197,94,0.1)',   color: '#16a34a', border: 'rgba(34,197,94,0.25)'   },
  upcoming:  { bg: 'rgba(255,85,0,0.08)',   color: '#ff5500', border: 'rgba(255,85,0,0.2)'     },
  completed: { bg: 'rgba(107,114,128,0.1)', color: '#6b7280', border: 'rgba(107,114,128,0.2)'  },
}

const ROLES = ['Player', 'Captain', 'Vice Captain']
const ROLE_STYLES = {
  'Captain':       { bg: 'rgba(255,179,0,0.12)', color: '#b45309', border: 'rgba(255,179,0,0.3)' },
  'Vice Captain':  { bg: 'rgba(99,102,241,0.1)', color: '#4338ca', border: 'rgba(99,102,241,0.25)' },
  'Player':        { bg: 'var(--bg-elevated)',    color: 'var(--text-2)', border: 'var(--border)' },
}

const POSITIONS = ['Feeder', 'Tekong', 'Killer']
const POSITION_STYLES = {
  'Feeder':  { bg: 'rgba(34,197,94,0.1)',   color: '#15803d', border: 'rgba(34,197,94,0.3)'  },
  'Tekong':  { bg: 'rgba(14,165,233,0.1)',  color: '#0369a1', border: 'rgba(14,165,233,0.3)' },
  'Killer':  { bg: 'rgba(239,68,68,0.1)',   color: '#b91c1c', border: 'rgba(239,68,68,0.3)'  },
}

/* ─── upload helper ─── */
async function uploadImage(path, file) {
  const snap = await uploadBytes(ref(storage, path), file)
  return getDownloadURL(snap.ref)
}

/* ══════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════ */
export default function LeagueDetail() {
  const { leagueId } = useParams()
  const navigate = useNavigate()

  const [league, setLeague]           = useState(null)
  const [teams, setTeams]             = useState([])
  const [editMode, setEditMode]       = useState(false)
  const [form, setForm]               = useState({})
  const [saving, setSaving]           = useState(false)
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [errors, setErrors]           = useState({})

  useEffect(() => {
    getDoc(doc(db, 'leagues', leagueId)).then(snap => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() }
        setLeague(data)
        setForm({ name: data.name, year: data.year, startDate: data.startDate || '', endDate: data.endDate || '', status: data.status, events: data.events || [] })
      }
    })
  }, [leagueId])

  useEffect(() => {
    return onSnapshot(collection(db, 'leagues', leagueId, 'teams'), snap =>
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [leagueId])

  const saveLeague = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (!form.startDate)   errs.startDate = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    await updateDoc(doc(db, 'leagues', leagueId), {
      name: form.name.trim(), year: form.year,
      startDate: form.startDate, endDate: form.endDate || null,
      status: form.status, events: form.events,
    })
    setLeague(l => ({ ...l, ...form }))
    setSaving(false)
    setEditMode(false)
    setErrors({})
  }

  if (!league) return <LoadingPage />

  const s = STATUS_STYLES[league.status] || STATUS_STYLES.upcoming

  return (
    <div className="page">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: '4px 0' }}>
          <BackIcon />
        </button>
        <div style={{ flex: 1 }}>
          <p className="page-subtitle">Admin Panel</p>
          <h1 className="page-title" style={{ fontSize: '1.25rem' }}>League Details</h1>
        </div>
      </div>

      {/* League info card */}
      <div className="card" style={{ marginBottom: 20, border: league.status === 'active' ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)', background: league.status === 'active' ? '#f0fdf4' : 'var(--bg-card)', overflow: 'hidden' }}>
        {league.status === 'active' && (
          <div style={{ height: 3, background: 'linear-gradient(90deg,#22c55e,#16a34a)', margin: '-16px -16px 14px', borderRadius: '14px 14px 0 0' }} />
        )}

        {!editMode ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 4 }}>{league.name}</p>
                <p style={{ color: 'var(--text-2)', fontSize: '0.8rem', marginBottom: 8 }}>
                  {league.startDate}{league.endDate ? ` → ${league.endDate}` : ''} · {league.year}
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                    {league.status.charAt(0).toUpperCase() + league.status.slice(1)}
                  </span>
                  {(league.events || []).map(ev => (
                    <span key={ev} style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 700, background: 'rgba(255,85,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,85,0,0.2)' }}>
                      {ev === 'Regu' ? '👟' : '🏐'} {ev}
                    </span>
                  ))}
                </div>
              </div>
              <button className="btn btn-secondary" onClick={() => setEditMode(true)} style={{ height: 36, padding: '0 14px', fontSize: '0.8rem', gap: 6, flexShrink: 0 }}>
                <EditIcon /> Edit
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={saveLeague} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: 4 }}>Edit League</p>
            <Field label="League Name *" error={errors.name}>
              <input style={inputStyle(errors.name)} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Year">
                <input style={inputStyle()} value={form.year} type="number" min="2020" max="2099" onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
              </Field>
              <Field label="Status">
                <select style={{ ...inputStyle(), cursor: 'pointer' }} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Start Date *" error={errors.startDate}>
                <input style={inputStyle(errors.startDate)} type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </Field>
              <Field label="End Date">
                <input style={inputStyle()} type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </Field>
            </div>
            <Field label="Events">
              <div style={{ display: 'flex', gap: 10 }}>
                {['Regu', 'Quad'].map(ev => {
                  const sel = (form.events || []).includes(ev)
                  return (
                    <button key={ev} type="button" onClick={() => setForm(f => ({ ...f, events: (f.events||[]).includes(ev) ? (f.events||[]).filter(e=>e!==ev) : [...(f.events||[]),ev] }))}
                      style={{ flex:1, height:48, borderRadius:10, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:'0.88rem', background: sel?'var(--accent)':'var(--bg-elevated)', color: sel?'#fff':'var(--text-2)', border: sel?'2px solid var(--accent)':'2px solid var(--border)', transition:'all 150ms ease', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                      {ev==='Regu'?'👟':'🏐'} {ev}
                    </button>
                  )
                })}
              </div>
            </Field>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setEditMode(false); setErrors({}) }} style={{ flex:1, height:44 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex:2, height:44, fontSize:'0.9rem' }}>
                {saving ? <><Spinner /> Saving…</> : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Teams section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <p className="page-subtitle" style={{ marginBottom: 2 }}>Teams</p>
          <p style={{ fontWeight: 800, fontSize: '1rem' }}>{teams.length} Team{teams.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddTeam(true)} style={{ height: 38, padding: '0 14px', fontSize: '0.8rem', gap: 6 }}>
          <PlusIcon /> Add Team
        </button>
      </div>

      {teams.length === 0 && !showAddTeam && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
          <p style={{ fontSize: '1.8rem', marginBottom: 10 }}>👥</p>
          <p style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 6 }}>No teams yet</p>
          <p style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>Add teams to this league.</p>
        </div>
      )}

      {showAddTeam && <AddTeamForm leagueId={leagueId} onClose={() => setShowAddTeam(false)} />}

      {teams.map(team => (
        <TeamCard key={team.id} team={team} leagueId={leagueId} leagueEvents={league.events || []} />
      ))}

      {/* Fixtures */}
      <FixturesSection leagueId={leagueId} league={league} teams={teams} />

    </div>
  )
}

/* ══════════════════════════════════════════
   ADD TEAM FORM
══════════════════════════════════════════ */
function AddTeamForm({ leagueId, onClose }) {
  const [name, setName]         = useState('')
  const [logoFile, setLogoFile] = useState(null)
  const [preview, setPreview]   = useState(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const fileRef = useRef()

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setError('Logo must be under 2MB'); return }
    setLogoFile(file)
    setPreview(URL.createObjectURL(file))
    setError('')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Team name is required'); return }
    setSaving(true)
    try {
      const teamRef = await addDoc(collection(db, 'leagues', leagueId, 'teams'), { name: name.trim(), logoUrl: null, createdAt: serverTimestamp() })
      if (logoFile) {
        const logoUrl = await uploadImage(`teams/${leagueId}/${teamRef.id}/logo`, logoFile)
        await updateDoc(doc(db, 'leagues', leagueId, 'teams', teamRef.id), { logoUrl })
      }
      onClose()
    } catch { setError('Failed to save. Try again.') }
    finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 12, border: '1px solid rgba(255,85,0,0.2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontWeight: 800, fontSize: '0.95rem' }}>Add Team</p>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: '1.1rem' }}>✕</button>
      </div>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <LogoUploadBox preview={preview} onClick={() => fileRef.current?.click()} size={64} />
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 3 }}>Team Logo</p>
            <p style={{ color: 'var(--text-2)', fontSize: '0.75rem', marginBottom: 6 }}>PNG or JPG · Max 2MB</p>
            <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} style={{ height: 34, padding: '0 12px', fontSize: '0.78rem' }}>
              {preview ? 'Change' : 'Upload'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        </div>
        <Field label="Team Name *">
          <input style={inputStyle(error && !name.trim())} placeholder="e.g. Chennai Challengers" value={name} onChange={e => { setName(e.target.value); setError('') }} />
        </Field>
        {error && <p style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ flex: 1, height: 44 }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 2, height: 44, fontSize: '0.9rem' }}>
            {saving ? <><Spinner /> Saving…</> : 'Add Team'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ══════════════════════════════════════════
   TEAM CARD  (with player management)
══════════════════════════════════════════ */
function TeamCard({ team, leagueId, leagueEvents }) {
  const [editMode, setEditMode]   = useState(false)
  const [expanded, setExpanded]   = useState(false)
  const [name, setName]           = useState(team.name)
  const [logoFile, setLogoFile]   = useState(null)
  const [preview, setPreview]     = useState(team.logoUrl)
  const [saving, setSaving]       = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [showAddPlayer, setShowAddPlayer] = useState(false)
  const [players, setPlayers]     = useState([])
  const fileRef = useRef()

  // Live players
  useEffect(() => {
    return onSnapshot(
      collection(db, 'leagues', leagueId, 'teams', team.id, 'players'),
      snap => setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [leagueId, team.id])

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setLogoFile(file)
    setPreview(URL.createObjectURL(file))
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      let logoUrl = team.logoUrl
      if (logoFile) logoUrl = await uploadImage(`teams/${leagueId}/${team.id}/logo`, logoFile)
      const newName = name.trim()

      // Update team doc
      await updateDoc(doc(db, 'leagues', leagueId, 'teams', team.id), { name: newName, logoUrl })

      // Propagate name + logo to all fixtures that reference this team
      const fixturesSnap = await getDocs(collection(db, 'leagues', leagueId, 'fixtures'))
      const batch = writeBatch(db)
      fixturesSnap.docs.forEach(d => {
        const f = d.data()
        const updates = {}
        if (f.homeTeam?.id === team.id) updates.homeTeam = { ...f.homeTeam, name: newName, logoUrl }
        if (f.awayTeam?.id === team.id) updates.awayTeam = { ...f.awayTeam, name: newName, logoUrl }
        if (Object.keys(updates).length > 0) batch.update(d.ref, updates)
      })
      await batch.commit()

      setEditMode(false)
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (team.logoUrl) await deleteObject(ref(storage, `teams/${leagueId}/${team.id}/logo`)).catch(() => {})
    await deleteDoc(doc(db, 'leagues', leagueId, 'teams', team.id))
  }

  const captain = players.find(p => p.role === 'Captain')

  return (
    <div className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>

      {/* Team header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
        <div style={{ width: 48, height: 48, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-elevated)', border: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {team.logoUrl ? <img src={team.logoUrl} alt={team.name} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '1.3rem' }}>👥</span>}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 800, fontSize: '0.95rem' }}>{team.name}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '0.72rem', marginTop: 2 }}>
            {players.length} player{players.length !== 1 ? 's' : ''}
            {captain ? ` · C: ${captain.name}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setExpanded(v => !v)}
            style={{ width: 36, height: 36, padding: 0, borderRadius: 8, fontSize: '0.75rem', fontWeight: 700 }}>
            {expanded ? '▲' : '▼'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setEditMode(v => !v); setExpanded(true) }}
            style={{ width: 36, height: 36, padding: 0, borderRadius: 8 }}>
            <EditIcon size={15} />
          </button>
          {confirmDel
            ? <button className="btn" onClick={handleDelete} style={{ height: 36, padding: '0 10px', fontSize: '0.75rem', background: '#dc2626', color: '#fff', borderRadius: 8 }}>Confirm</button>
            : <button className="btn btn-secondary" onClick={() => setConfirmDel(true)} style={{ width: 36, height: 36, padding: 0, borderRadius: 8, color: '#dc2626' }}><TrashIcon /></button>}
        </div>
      </div>

      {/* Inline edit */}
      {editMode && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <LogoUploadBox preview={preview} onClick={() => fileRef.current?.click()} size={52} />
            <input style={{ ...inputStyle(), flex: 1 }} value={name} onChange={e => setName(e.target.value)} placeholder="Team name" />
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => { setEditMode(false); setName(team.name); setPreview(team.logoUrl) }} style={{ flex: 1, height: 40 }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 2, height: 40, fontSize: '0.85rem' }}>
              {saving ? <><Spinner /> Saving…</> : 'Save Team'}
            </button>
          </div>
        </div>
      )}

      {/* Expanded player section */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>

          {/* Player list */}
          <div style={{ padding: '12px 16px' }}>
            {players.length === 0 && !showAddPlayer && (
              <p style={{ color: 'var(--text-3)', fontSize: '0.82rem', textAlign: 'center', padding: '8px 0' }}>No players added yet.</p>
            )}

            {players.map(player => (
              <PlayerRow key={player.id} player={player} leagueId={leagueId} teamId={team.id} leagueEvents={leagueEvents} />
            ))}

            {showAddPlayer
              ? <AddPlayerForm leagueId={leagueId} teamId={team.id} onClose={() => setShowAddPlayer(false)} existingPlayers={players} leagueEvents={leagueEvents} />
              : (
                <button className="btn btn-secondary" onClick={() => setShowAddPlayer(true)}
                  style={{ width: '100%', height: 40, fontSize: '0.82rem', gap: 6, marginTop: players.length > 0 ? 10 : 0 }}>
                  <PlusIcon /> Add Player
                </button>
              )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════
   ADD PLAYER FORM
══════════════════════════════════════════ */
function AddPlayerForm({ leagueId, teamId, onClose, existingPlayers, leagueEvents }) {
  const [name, setName]           = useState('')
  const [role, setRole]           = useState('Player')
  const [position, setPosition]   = useState('Feeder')
  const [events, setEvents]       = useState(leagueEvents.length === 1 ? [...leagueEvents] : [...leagueEvents])
  const [photoFile, setPhotoFile] = useState(null)
  const [preview, setPreview]     = useState(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const fileRef = useRef()

  const toggleEvent = (ev) =>
    setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev])

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 3 * 1024 * 1024) { setError('Photo must be under 3MB'); return }
    setPhotoFile(file)
    setPreview(URL.createObjectURL(file))
    setError('')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Player name is required'); return }
    if (role === 'Captain' && existingPlayers.some(p => p.role === 'Captain')) {
      setError('A captain already exists. Remove or change the current captain first.')
      return
    }
    if (role === 'Vice Captain' && existingPlayers.some(p => p.role === 'Vice Captain')) {
      setError('A vice captain already exists.')
      return
    }
    if (leagueEvents.length > 0 && events.length === 0) {
      setError('Select at least one event.')
      return
    }
    setSaving(true)
    try {
      const playerRef = await addDoc(
        collection(db, 'leagues', leagueId, 'teams', teamId, 'players'),
        { name: name.trim(), role, position, events, photoUrl: null, createdAt: serverTimestamp() }
      )
      if (photoFile) {
        const photoUrl = await uploadImage(`players/${leagueId}/${teamId}/${playerRef.id}/photo`, photoFile)
        await updateDoc(doc(db, 'leagues', leagueId, 'teams', teamId, 'players', playerRef.id), { photoUrl })
      }
      onClose()
    } catch { setError('Failed to save. Try again.') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,85,0,0.18)', borderRadius: 12, padding: 14, marginTop: 10 }}>
      <p style={{ fontWeight: 800, fontSize: '0.88rem', marginBottom: 12 }}>Add Player</p>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Photo + name row */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div onClick={() => fileRef.current?.click()} style={{ width: 60, height: 60, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-elevated)', border: '2px dashed var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {preview
              ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <svg width="22" height="22" fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
          </div>
          <input style={{ ...inputStyle(), flex: 1 }} placeholder="Player name" value={name} onChange={e => { setName(e.target.value); setError('') }} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        </div>

        {/* Role selector */}
        <div>
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Role</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {ROLES.map(r => {
              const sel = role === r
              const rs = ROLE_STYLES[r]
              return (
                <button key={r} type="button" onClick={() => setRole(r)}
                  style={{ flex: 1, height: 42, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.72rem', background: sel ? rs.bg : 'var(--bg-elevated)', color: sel ? rs.color : 'var(--text-3)', border: sel ? `1.5px solid ${rs.border}` : '1.5px solid var(--border)', transition: 'all 150ms ease' }}>
                  {r === 'Captain' ? '© C' : r === 'Vice Captain' ? '© VC' : 'Player'}
                </button>
              )
            })}
          </div>
        </div>

        {/* Position selector */}
        <div>
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Position</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {POSITIONS.map(pos => {
              const sel = position === pos
              const ps = POSITION_STYLES[pos]
              return (
                <button key={pos} type="button" onClick={() => setPosition(pos)}
                  style={{ flex: 1, height: 42, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.75rem', background: sel ? ps.bg : 'var(--bg-elevated)', color: sel ? ps.color : 'var(--text-3)', border: sel ? `1.5px solid ${ps.border}` : '1.5px solid var(--border)', transition: 'all 150ms ease' }}>
                  {pos}
                </button>
              )
            })}
          </div>
        </div>

        {/* Event selector — only shown when league has events */}
        {leagueEvents.length > 0 && (
          <div>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              Playing In {leagueEvents.length > 1 ? '(select all that apply)' : ''}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {leagueEvents.map(ev => {
                const sel = events.includes(ev)
                return (
                  <button key={ev} type="button" onClick={() => toggleEvent(ev)}
                    style={{ flex: 1, height: 42, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.82rem', background: sel ? 'var(--accent)' : 'var(--bg-elevated)', color: sel ? '#fff' : 'var(--text-3)', border: sel ? '1.5px solid var(--accent)' : '1.5px solid var(--border)', transition: 'all 150ms ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {ev === 'Regu' ? '👟' : '🏐'} {ev}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {error && <p style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ flex: 1, height: 40 }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 2, height: 40, fontSize: '0.85rem' }}>
            {saving ? <><Spinner /> Saving…</> : 'Add Player'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ══════════════════════════════════════════
   PLAYER ROW
══════════════════════════════════════════ */
function PlayerRow({ player, leagueId, teamId, leagueEvents }) {
  const [editMode, setEditMode]     = useState(false)
  const [name, setName]             = useState(player.name)
  const [role, setRole]             = useState(player.role)
  const [position, setPosition]     = useState(player.position || 'Feeder')
  const [events, setEvents]         = useState(player.events || [...(leagueEvents || [])])
  const [photoFile, setPhotoFile]   = useState(null)
  const [preview, setPreview]       = useState(player.photoUrl)
  const [saving, setSaving]         = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const fileRef = useRef()

  const toggleEvent = (ev) =>
    setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev])

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      let photoUrl = player.photoUrl
      if (photoFile) photoUrl = await uploadImage(`players/${leagueId}/${teamId}/${player.id}/photo`, photoFile)
      await updateDoc(doc(db, 'leagues', leagueId, 'teams', teamId, 'players', player.id), { name: name.trim(), role, position, events, photoUrl })
      setEditMode(false)
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (player.photoUrl) await deleteObject(ref(storage, `players/${leagueId}/${teamId}/${player.id}/photo`)).catch(() => {})
    await deleteDoc(doc(db, 'leagues', leagueId, 'teams', teamId, 'players', player.id))
  }

  const cancelEdit = () => {
    setEditMode(false)
    setName(player.name)
    setRole(player.role)
    setPosition(player.position || 'Feeder')
    setEvents(player.events || [...(leagueEvents || [])])
    setPreview(player.photoUrl)
  }

  if (editMode) {
    return (
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div onClick={() => fileRef.current?.click()} style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-card)', border: '2px dashed var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserIcon />}
          </div>
          <input style={{ ...inputStyle(), flex: 1 }} value={name} onChange={e => setName(e.target.value)} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f=e.target.files[0]; if(f){ setPhotoFile(f); setPreview(URL.createObjectURL(f)) } }} />
        </div>
        {/* Role */}
        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Role</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {ROLES.map(r => {
            const sel = role === r
            const rs = ROLE_STYLES[r]
            return (
              <button key={r} type="button" onClick={() => setRole(r)}
                style={{ flex:1, height:36, borderRadius:8, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:'0.68rem', background: sel?rs.bg:'var(--bg-card)', color: sel?rs.color:'var(--text-3)', border: sel?`1.5px solid ${rs.border}`:'1.5px solid var(--border)', transition:'all 150ms ease' }}>
                {r==='Captain'?'© C': r==='Vice Captain'?'© VC':'Player'}
              </button>
            )
          })}
        </div>
        {/* Position */}
        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Position</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {POSITIONS.map(pos => {
            const sel = position === pos
            const ps = POSITION_STYLES[pos]
            return (
              <button key={pos} type="button" onClick={() => setPosition(pos)}
                style={{ flex:1, height:36, borderRadius:8, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:'0.72rem', background: sel?ps.bg:'var(--bg-card)', color: sel?ps.color:'var(--text-3)', border: sel?`1.5px solid ${ps.border}`:'1.5px solid var(--border)', transition:'all 150ms ease' }}>
                {pos}
              </button>
            )
          })}
        </div>
        {/* Event */}
        {(leagueEvents || []).length > 0 && (
          <>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Playing In</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {leagueEvents.map(ev => {
                const sel = events.includes(ev)
                return (
                  <button key={ev} type="button" onClick={() => toggleEvent(ev)}
                    style={{ flex:1, height:36, borderRadius:8, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:'0.75rem', background: sel?'var(--accent)':'var(--bg-card)', color: sel?'#fff':'var(--text-3)', border: sel?'1.5px solid var(--accent)':'1.5px solid var(--border)', transition:'all 150ms ease', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                    {ev === 'Regu' ? '👟' : '🏐'} {ev}
                  </button>
                )
              })}
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={cancelEdit} style={{ flex:1, height:36, fontSize:'0.78rem' }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex:2, height:36, fontSize:'0.78rem' }}>{saving ? <><Spinner /> Saving…</> : 'Save'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
      <PlayerAvatar player={player} size={40} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <p style={{ fontWeight: 700, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.name}</p>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 3 }}>
          <RoleBadge role={player.role} small />
          {player.position && <PositionBadge position={player.position} small />}
          {(player.events || []).map(ev => (
            <span key={ev} style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 20, fontSize: '0.6rem', fontWeight: 700, background: 'rgba(255,85,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,85,0,0.2)' }}>
              {ev === 'Regu' ? '👟' : '🏐'} {ev}
            </span>
          ))}
        </div>
      </div>
      <button className="btn btn-secondary" onClick={() => setEditMode(true)} style={{ width:32, height:32, padding:0, borderRadius:8 }}><EditIcon size={13} /></button>
      {confirmDel
        ? <button className="btn" onClick={handleDelete} style={{ height:32, padding:'0 8px', fontSize:'0.7rem', background:'#dc2626', color:'#fff', borderRadius:8 }}>✓</button>
        : <button className="btn btn-secondary" onClick={() => setConfirmDel(true)} style={{ width:32, height:32, padding:0, borderRadius:8, color:'#dc2626' }}><TrashIcon /></button>}
    </div>
  )
}

/* ── Shared sub-components ── */
function PlayerAvatar({ player, size = 36 }) {
  const [imgError, setImgError] = useState(false)
  return (player.photoUrl && !imgError)
    ? <img src={player.photoUrl} alt={player.name} referrerPolicy="no-referrer" onError={() => setImgError(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--border)' }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent-mid)', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 800, fontSize: size*0.38, color: 'var(--accent)' }}>
        {player.name[0].toUpperCase()}
      </div>
}

function RoleBadge({ role, small }) {
  const rs = ROLE_STYLES[role] || ROLE_STYLES.Player
  return (
    <span style={{ display: 'inline-block', padding: small ? '1px 7px' : '3px 10px', borderRadius: 20, fontSize: small ? '0.6rem' : '0.65rem', fontWeight: 700, background: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}>
      {role === 'Captain' ? '© Captain' : role === 'Vice Captain' ? '© Vice Captain' : 'Player'}
    </span>
  )
}

function PositionBadge({ position, small }) {
  const ps = POSITION_STYLES[position]
  if (!ps) return null
  return (
    <span style={{ display: 'inline-block', padding: small ? '1px 7px' : '3px 10px', borderRadius: 20, fontSize: small ? '0.6rem' : '0.65rem', fontWeight: 700, background: ps.bg, color: ps.color, border: `1px solid ${ps.border}` }}>
      {position}
    </span>
  )
}

function LogoUploadBox({ preview, onClick, size = 64 }) {
  return (
    <div onClick={onClick} style={{ width: size, height: size, borderRadius: 12, background: 'var(--bg-elevated)', border: '2px dashed var(--border)', cursor: 'pointer', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UploadIcon />}
    </div>
  )
}

function LoadingPage() {
  return <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60dvh' }}><p style={{ color: 'var(--text-2)' }}>Loading…</p></div>
}

/* ══════════════════════════════════════════
   FIXTURE GENERATOR HELPERS
══════════════════════════════════════════ */
function getFirstSunday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()           // 0=Sun
  if (day !== 0) d.setDate(d.getDate() + (7 - day))
  return d
}

function buildRoundRobin(teams) {
  if (teams.length < 2) return []
  const ts = [...teams]
  if (ts.length % 2 !== 0) ts.push(null)   // bye for odd count
  const n = ts.length
  const rotating = ts.slice(1)
  const rounds = []
  for (let r = 0; r < n - 1; r++) {
    const all = [ts[0], ...rotating]
    const round = []
    for (let i = 0; i < n / 2; i++) {
      const home = all[i], away = all[n - 1 - i]
      if (home && away) round.push({ home, away })
    }
    if (round.length) rounds.push(round)
    rotating.unshift(rotating.pop())
  }
  return rounds
}

// Reorder matches on a single day so no team plays back-to-back.
// Greedy: for each slot, pick a match where neither team played the previous match.
function scheduleDay(matches) {
  const remaining = [...matches]
  const ordered   = []
  let lastTeams   = new Set()

  while (remaining.length > 0) {
    const idx = remaining.findIndex(
      m => !lastTeams.has(m.home.id) && !lastTeams.has(m.away.id)
    )
    const pick = idx >= 0 ? remaining.splice(idx, 1)[0] : remaining.shift()
    ordered.push(pick)
    lastTeams = new Set([pick.home.id, pick.away.id])
  }
  return ordered
}

// Returns [{date, matches:[{event,leg,home,away}]}] — one entry per Sunday.
// Both Regu and Quad are on the SAME Sunday each week (each team plays once per event).
// Within the day the match order is rearranged so no team plays two consecutive matches.
function generateFixtures(teams, events, startDate) {
  if (teams.length < 2 || !events.length || !startDate) return []

  const firstSunday = getFirstSunday(startDate)
  const leg1 = buildRoundRobin(teams)              // N-1 rounds
  const leg2 = leg1.map(r => r.map(m => ({ home: m.away, away: m.home })))
  const N1   = leg1.length                         // N-1

  const sunday = (weekOffset) => {
    const d = new Date(firstSunday)
    d.setDate(d.getDate() + weekOffset * 7)
    // Use local date parts — toISOString() returns UTC which shifts the date
    // back by a day in IST (UTC+5:30), turning Sunday into Saturday
    const y  = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    return `${y}-${mo}-${dy}`
  }

  const hasRegu = events.includes('Regu')
  const hasQuad = events.includes('Quad')

  // ── Single event: one round per Sunday ──────────────────
  if (!hasRegu || !hasQuad) {
    const ev = hasRegu ? 'Regu' : 'Quad'
    return [
      ...leg1.map((r, i) => ({
        date: sunday(i),
        matches: r.map(m => ({ event: ev, leg: 1, home: m.home, away: m.away })),
      })),
      ...leg2.map((r, i) => ({
        date: sunday(N1 + i),
        matches: r.map(m => ({ event: ev, leg: 2, home: m.home, away: m.away })),
      })),
    ]
  }

  // ── Both events on the SAME Sunday ──────────────────────
  // Regu uses leg[i], Quad uses leg[(i+1)%N1] so opponents differ.
  // Then scheduleDay() reorders the combined match list to ensure
  // no team appears in two consecutive match slots on that day.
  const sundays = []

  // Leg 1
  for (let i = 0; i < N1; i++) {
    const raw = [
      ...leg1[i].map(m => ({ event: 'Regu', leg: 1, home: m.home, away: m.away })),
      ...leg1[(i + 1) % N1].map(m => ({ event: 'Quad', leg: 1, home: m.home, away: m.away })),
    ]
    sundays.push({ date: sunday(i), matches: scheduleDay(raw) })
  }

  // Leg 2
  for (let i = 0; i < N1; i++) {
    const raw = [
      ...leg2[i].map(m => ({ event: 'Regu', leg: 2, home: m.home, away: m.away })),
      ...leg2[(i + 1) % N1].map(m => ({ event: 'Quad', leg: 2, home: m.home, away: m.away })),
    ]
    sundays.push({ date: sunday(N1 + i), matches: scheduleDay(raw) })
  }

  return sundays
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/* ══════════════════════════════════════════
   FIXTURES SECTION
══════════════════════════════════════════ */
function FixturesSection({ leagueId, league, teams }) {
  const [existing, setExisting]     = useState([])
  const [preview, setPreview]       = useState(null)   // unsaved preview
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [collapsed, setCollapsed]   = useState(true)   // existing fixtures list
  const [rescheduleFixture, setRescheduleFixture] = useState(null) // { id, homeTeam, awayTeam, event, leg, date }
  const [rescheduleDate, setRescheduleDate]       = useState('')
  const [rescheduleSaving, setRescheduleSaving]   = useState(false)
  const [powByDate, setPowByDate]   = useState({})
  const [powSheetDate, setPowSheetDate] = useState(null)
  const [showInspector, setShowInspector] = useState(false)

  useEffect(() => {
    return onSnapshot(collection(db, 'leagues', leagueId, 'fixtures'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      all.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      setExisting(all)
    })
  }, [leagueId])

  useEffect(() => {
    return onSnapshot(collection(db, 'leagues', leagueId, 'pow'), snap => {
      const map = {}
      snap.docs.forEach(d => { map[d.id] = { date: d.id, ...d.data() } })
      setPowByDate(map)
    })
  }, [leagueId])

  const events = league.events || []

  const handleGenerate = () => {
    // If fixtures already saved, block entirely
    if (existing.length > 0) return
    // Show confirm before first-time generation
    setConfirmRegen(true)
  }

  const doGenerate = () => {
    if (teams.length < 2) return
    // generateFixtures returns [{date, matches:[{event,leg,home,away}]}]
    const sundays = generateFixtures(teams, events, league.startDate)
    setPreview(sundays)
    setConfirmRegen(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const batch = writeBatch(db)
      const snap = await getDocs(collection(db, 'leagues', leagueId, 'fixtures'))
      snap.docs.forEach(d => batch.delete(d.ref))
      preview.forEach(sunday => {
        sunday.matches.forEach(match => {
          const ref = doc(collection(db, 'leagues', leagueId, 'fixtures'))
          batch.set(ref, {
            event:    match.event,
            leg:      match.leg,
            date:     sunday.date,
            homeTeam: { id: match.home.id, name: match.home.name, logoUrl: match.home.logoUrl || null },
            awayTeam: { id: match.away.id, name: match.away.name, logoUrl: match.away.logoUrl || null },
            status:   'scheduled',
            homeScore: null,
            awayScore: null,
            createdAt: serverTimestamp(),
          })
        })
      })
      await batch.commit()
      setPreview(null)
      setCollapsed(false)
    } finally { setSaving(false) }
  }

  const totalPreviewMatches = preview ? preview.reduce((s, s2) => s + s2.matches.length, 0) : 0

  const openReschedule = (f) => {
    setRescheduleFixture(f)
    setRescheduleDate(f.date || '')
  }

  const handleReschedule = async () => {
    if (!rescheduleDate || !rescheduleFixture) return
    setRescheduleSaving(true)
    try {
      await updateDoc(doc(db, 'leagues', leagueId, 'fixtures', rescheduleFixture.id), { date: rescheduleDate })
      setRescheduleFixture(null)
    } finally { setRescheduleSaving(false) }
  }

  // Group existing fixtures by date
  const existingByDate = {}
  existing.forEach(f => {
    if (!existingByDate[f.date]) existingByDate[f.date] = []
    existingByDate[f.date].push(f)
  })
  const existingDates = Object.keys(existingByDate).sort()

  const downloadFixturesPDF = () => {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()

    // Header
    pdf.setFillColor(26, 26, 46)
    pdf.rect(0, 0, pageW, 28, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.text('Chennai Sepak Takraw League', pageW / 2, 11, { align: 'center' })
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`${league.name} · ${league.year || ''}`, pageW / 2, 19, { align: 'center' })
    pdf.text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`, pageW / 2, 25, { align: 'center' })

    let y = 34
    existingDates.forEach(date => {
      const fixtures = existingByDate[date]
      const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

      // Date heading
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.setTextColor(255, 85, 0)
      pdf.text(dateLabel, 14, y)
      y += 2

      const rows = fixtures.map((f, i) => {
        const status = f.status === 'completed'
          ? `${f.homeScore ?? 0} – ${f.awayScore ?? 0}`
          : f.status === 'live' ? 'Live' : 'Scheduled'
        return [
          i + 1,
          f.homeTeam?.name || '—',
          'vs',
          f.awayTeam?.name || '—',
          f.event || '—',
          `Leg ${f.leg || '—'}`,
          status,
        ]
      })

      autoTable(pdf, {
        startY: y,
        head: [['#', 'Home Team', '', 'Away Team', 'Event', 'Leg', 'Result']],
        body: rows,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 3, textColor: [30, 30, 30] },
        headStyles: { fillColor: [26, 26, 46], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          2: { cellWidth: 8, halign: 'center', textColor: [150, 150, 150] },
          4: { cellWidth: 18 },
          5: { cellWidth: 14 },
          6: { cellWidth: 22, halign: 'center' },
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        margin: { left: 14, right: 14 },
      })

      y = pdf.lastAutoTable.finalY + 8
    })

    // Footer
    pdf.setFontSize(7)
    pdf.setTextColor(150)
    pdf.setFont('helvetica', 'normal')
    pdf.text('Chennai Sepak Takraw League · Fixture Schedule', pageW / 2, pdf.internal.pageSize.getHeight() - 6, { align: 'center' })

    pdf.save(`${league.name}-fixtures.pdf`)
  }

  const totalMatches = preview
    ? preview.reduce((s, r) => s + r.matches.length, 0)
    : existing.length

  return (
    <div style={{ marginTop: 24 }}>
      {/* Section header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <p className="page-subtitle" style={{ marginBottom: 2 }}>Fixtures</p>
          <p style={{ fontWeight: 800, fontSize: '1rem' }}>
            {existing.length > 0 ? `${existing.length} Match${existing.length !== 1 ? 'es' : ''} Scheduled` : 'No fixtures yet'}
          </p>
        </div>
        {existing.length === 0 && !preview && (
          <button className="btn btn-primary" onClick={handleGenerate} disabled={teams.length < 2}
            style={{ height: 38, padding: '0 14px', fontSize: '0.8rem', gap: 6 }}>
            <ShuffleIcon /> Generate Fixtures
          </button>
        )}
        {existing.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={downloadFixturesPDF}
              style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1.5px solid rgba(255,85,0,0.3)', background: 'rgba(255,85,0,0.06)', color: 'var(--accent)', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
              ⬇ PDF
            </button>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-3)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
              🔒 Locked
            </span>
          </div>
        )}
      </div>

      {existing.length > 0 && (
        <div style={{ background: 'rgba(107,114,128,0.06)', border: '1px solid rgba(107,114,128,0.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', fontWeight: 600 }}>
            🔒 Fixtures are locked. To make changes, delete this tournament and create a new one.
          </p>
        </div>
      )}

      {teams.length < 2 && (
        <div style={{ background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>Add at least 2 teams before generating fixtures.</p>
        </div>
      )}

      {/* Confirm generate */}
      {confirmRegen && (
        <div style={{ background: 'rgba(255,85,0,0.05)', border: '1px solid rgba(255,85,0,0.2)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <p style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)', marginBottom: 4 }}>Generate Fixtures?</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginBottom: 4 }}>
            This will generate {teams.length} team{teams.length !== 1 ? 's' : ''} · {(league.events || []).join(' & ')} fixtures starting {league.startDate || 'from start date'}.
          </p>
          <p style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600, marginBottom: 12 }}>
            ⚠️ Once saved, fixtures cannot be regenerated. You can only delete and recreate the tournament.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setConfirmRegen(false)} style={{ flex: 1, height: 38 }}>Cancel</button>
            <button onClick={doGenerate} style={{ flex: 2, height: 38, borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.85rem', background: 'var(--accent)', color: '#fff' }}>
              Yes, Generate
            </button>
          </div>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="card" style={{ marginBottom: 12, border: '1px solid rgba(255,85,0,0.2)', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontWeight: 800, fontSize: '0.95rem' }}>Preview</p>
              <p style={{ color: 'var(--text-2)', fontSize: '0.75rem', marginTop: 2 }}>
                {totalPreviewMatches} matches · {preview.length} Sundays
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setPreview(null)} style={{ height: 36, padding: '0 12px', fontSize: '0.8rem' }}>Discard</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ height: 36, padding: '0 14px', fontSize: '0.8rem' }}>
                {saving ? <><Spinner /> Saving…</> : 'Confirm & Save'}
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            {preview.map(sunday => (
              <PreviewSunday key={sunday.date} sunday={sunday} />
            ))}
          </div>
        </div>
      )}

      {/* Existing fixtures */}
      {!preview && existing.length > 0 && (
        <>
          <button className="btn btn-secondary" onClick={() => setCollapsed(v => !v)}
            style={{ width: '100%', height: 40, fontSize: '0.82rem', gap: 6, marginBottom: collapsed ? 0 : 10 }}>
            {collapsed ? '▼ Show Fixtures' : '▲ Hide Fixtures'}
          </button>
          {!collapsed && existingDates.map(date => (
            <ExistingDateGroup key={date} date={date} fixtures={existingByDate[date]} events={events} onReschedule={openReschedule} pow={powByDate[date] || null} onSetPow={() => setPowSheetDate(date)} />
          ))}
        </>
      )}

      {/* POW Sheet */}
      {powSheetDate && (
        <PowSheet
          leagueId={leagueId}
          date={powSheetDate}
          existingPow={powByDate[powSheetDate] || null}
          onClose={() => setPowSheetDate(null)}
        />
      )}

      {/* Reschedule Modal */}
      {rescheduleFixture && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setRescheduleFixture(null) }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480, boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' }}>
            {/* Handle */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 20px' }} />

            <p style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>Reschedule Match</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginBottom: 16 }}>
              {rescheduleFixture.homeTeam?.name} vs {rescheduleFixture.awayTeam?.name}
              <span style={{ marginLeft: 8, fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)' }}>
                {rescheduleFixture.event} · Leg {rescheduleFixture.leg}
              </span>
            </p>

            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>New Date</p>
            <input
              type="date"
              value={rescheduleDate}
              onChange={e => setRescheduleDate(e.target.value)}
              style={{ width: '100%', height: 46, borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-card)', padding: '0 14px', fontSize: '0.95rem', fontFamily: 'inherit', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box', marginBottom: 20 }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setRescheduleFixture(null)} style={{ flex: 1, height: 46 }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleReschedule}
                disabled={rescheduleSaving || !rescheduleDate || rescheduleDate === rescheduleFixture.date}
                style={{ flex: 2, height: 46 }}>
                {rescheduleSaving ? <><Spinner /> Saving…</> : 'Confirm Reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Preview Sunday block ── */
function PreviewSunday({ sunday }) {
  const byEvent = {}
  sunday.matches.forEach(m => {
    if (!byEvent[m.event]) byEvent[m.event] = []
    byEvent[m.event].push(m)
  })

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Date header */}
      <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
        <p style={{ fontWeight: 700, fontSize: '0.82rem' }}>{formatDate(sunday.date)}</p>
        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-3)', fontWeight: 600 }}>
          {sunday.matches.length} match{sunday.matches.length !== 1 ? 'es' : ''}
        </span>
      </div>

      {/* Matches grouped by event */}
      {Object.entries(byEvent).map(([ev, matches]) => (
        <div key={ev}>
          <div style={{ padding: '5px 16px 3px 28px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent)' }}>
              {ev === 'Regu' ? '👟' : '🏐'} {ev} · Leg {matches[0].leg}
            </span>
          </div>
          {matches.map((m, mi) => (
            <div key={mi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 16px 5px 36px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.home.name}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-3)', fontWeight: 800, flexShrink: 0, padding: '2px 8px', background: 'var(--bg-elevated)', borderRadius: 6 }}>vs</span>
              <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.away.name}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Existing fixtures date group ── */
function ExistingDateGroup({ date, fixtures, events, onReschedule, pow, onSetPow }) {
  const allCompleted = fixtures.length > 0 && fixtures.every(f => f.status === 'completed')

  return (
    <div className="card" style={{ marginBottom: 8, padding: 0, overflow: 'hidden' }}>
      {/* Date header */}
      <div style={{ padding: '10px 14px 8px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="13" height="13" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-2)', flex: 1 }}>{formatDate(date)}</p>
        <button
          onClick={allCompleted ? onSetPow : undefined}
          disabled={!allCompleted}
          title={!allCompleted ? 'All matches must be completed before setting POW' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 20,
            cursor: allCompleted ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', fontSize: '0.62rem', fontWeight: 700,
            background: !allCompleted ? 'var(--bg-elevated)' : pow ? 'rgba(230,149,0,0.15)' : 'rgba(230,149,0,0.08)',
            border: !allCompleted ? '1px solid var(--border)' : pow ? '1px solid rgba(230,149,0,0.45)' : '1px solid rgba(230,149,0,0.25)',
            color: !allCompleted ? 'var(--text-3)' : '#b45309',
            opacity: !allCompleted ? 0.5 : 1,
          }}>
          🏆 {pow ? pow.playerName.split(' ')[0] : 'Set POW'}
        </button>
      </div>

      {/* Fixture rows */}
      {fixtures.map(f => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-light)' }}>
          <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: '0.6rem', fontWeight: 700, background: 'rgba(255,85,0,0.08)', color: 'var(--accent)', border: '1px solid rgba(255,85,0,0.15)', flexShrink: 0 }}>
            {f.event === 'Regu' ? '👟' : '🏐'} {f.event} · L{f.leg}
          </span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <TeamPill team={f.homeTeam} align="right" />
            <span style={{ fontSize: '0.68rem', color: 'var(--text-3)', fontWeight: 800, flexShrink: 0 }}>vs</span>
            <TeamPill team={f.awayTeam} align="left" />
          </div>
          <StatusChip status={f.status} />
          {f.status === 'scheduled' && (
            <button onClick={() => onReschedule(f)} title="Reschedule"
              style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="13" height="13" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </button>
          )}
        </div>
      ))}

      {/* POW strip — shown when a POW is set for this date */}
      {pow && (
        <div
          onClick={onSetPow}
          style={{ padding: '8px 14px', background: 'rgba(230,149,0,0.06)', borderTop: '1px dashed rgba(230,149,0,0.25)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(230,149,0,0.35)', background: 'rgba(230,149,0,0.12)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {pow.photoUrl
              ? <img src={pow.photoUrl} alt={pow.playerName} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#b45309' }}>{pow.playerName?.[0]?.toUpperCase()}</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 800, color: '#92400e' }}>🏆 {pow.playerName}</p>
            <p style={{ fontSize: '0.6rem', color: '#b45309', marginTop: 1 }}>{pow.teamName}{pow.position ? ` · ${pow.position}` : ''}</p>
          </div>
          <span style={{ fontSize: '0.6rem', color: '#b45309', fontWeight: 700, flexShrink: 0 }}>Edit →</span>
        </div>
      )}
    </div>
  )
}

function TeamPill({ team, align }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', overflow: 'hidden' }}>
      {align === 'right' && <span style={{ fontWeight: 700, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>}
      {team.logoUrl
        ? <img src={team.logoUrl} alt={team.name} referrerPolicy="no-referrer" style={{ width: 24, height: 24, borderRadius: 5, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} />
        : <div style={{ width: 24, height: 24, borderRadius: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', flexShrink: 0 }}>👥</div>}
      {align === 'left' && <span style={{ fontWeight: 700, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>}
    </div>
  )
}

function StatusChip({ status }) {
  const styles = {
    scheduled: { bg: 'var(--bg-elevated)', color: 'var(--text-3)', border: 'var(--border)', label: 'Scheduled' },
    live:      { bg: 'rgba(34,197,94,0.1)', color: '#16a34a', border: 'rgba(34,197,94,0.3)', label: '● Live' },
    completed: { bg: 'rgba(107,114,128,0.1)', color: '#6b7280', border: 'rgba(107,114,128,0.2)', label: 'Done' },
  }
  const s = styles[status] || styles.scheduled
  return (
    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: '0.6rem', fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`, flexShrink: 0 }}>
      {s.label}
    </span>
  )
}

/* ══════════════════════════════════════════
   POW SHEET
══════════════════════════════════════════ */
function PowSheet({ leagueId, date, existingPow, onClose }) {
  const [teams,            setTeams]           = useState([])
  const [players,          setPlayers]         = useState([])
  const [selectedTeamId,   setSelectedTeamId]  = useState(existingPow?.teamId || '')
  const [selectedPlayerId, setSelectedPlayerId]= useState(existingPow?.playerId || '')
  const [note,             setNote]            = useState(existingPow?.note || '')
  const [saving,           setSaving]          = useState(false)
  const [visible,          setVisible]         = useState(false)

  useEffect(() => { setTimeout(() => setVisible(true), 30) }, [])

  useEffect(() => {
    getDocs(collection(db, 'leagues', leagueId, 'teams')).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))
      setTeams(all)
      if (!existingPow && all.length > 0) setSelectedTeamId(all[0].id)
    })
  }, [leagueId])

  useEffect(() => {
    if (!selectedTeamId) return
    setPlayers([])
    getDocs(collection(db, 'leagues', leagueId, 'teams', selectedTeamId, 'players')).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))
      setPlayers(all)
      if (existingPow?.teamId === selectedTeamId) {
        setSelectedPlayerId(existingPow.playerId)
      } else {
        setSelectedPlayerId(all[0]?.id || '')
      }
    })
  }, [selectedTeamId])

  const close = () => { setVisible(false); setTimeout(onClose, 300) }

  const handleSave = async () => {
    const team   = teams.find(t => t.id === selectedTeamId)
    const player = players.find(p => p.id === selectedPlayerId)
    if (!team || !player) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'leagues', leagueId, 'pow', date), {
        date,
        teamId:     team.id,
        teamName:   team.name,
        teamLogo:   team.logoUrl || null,
        playerId:   player.id,
        playerName: player.name,
        position:   player.position || null,
        photoUrl:   player.photoUrl || null,
        note:       note.trim() || null,
        updatedAt:  serverTimestamp(),
      })
      close()
    } finally { setSaving(false) }
  }

  const handleClear = async () => {
    if (!window.confirm('Remove Player of the Week for this date?')) return
    await deleteDoc(doc(db, 'leagues', leagueId, 'pow', date))
    close()
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 800, opacity: visible ? 1 : 0, transition: 'opacity 220ms ease' }} />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%',
        transform: `translateX(-50%) translateY(${visible ? '0' : '100%'})`,
        transition: 'transform 320ms cubic-bezier(0.32,0.72,0,1)',
        width: '100%', maxWidth: 480,
        background: 'var(--bg-card)', borderRadius: '24px 24px 0 0',
        border: '1px solid var(--border)', borderBottom: 'none',
        zIndex: 801, maxHeight: '88dvh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 20px 16px' }}>
          <p style={{ fontWeight: 900, fontSize: '1rem', marginBottom: 2, paddingTop: 12 }}>🏆 Player of the Week</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginBottom: 16 }}>{formatDate(date)}</p>

          {/* Team picker */}
          <p style={powLabelStyle}>Team</p>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 16, scrollbarWidth: 'none' }}>
            {teams.map(t => (
              <div key={t.id} onClick={() => setSelectedTeamId(t.id)} style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px 6px 8px', borderRadius: 10, cursor: 'pointer',
                border: selectedTeamId === t.id ? '2px solid var(--accent)' : '2px solid var(--border)',
                background: selectedTeamId === t.id ? 'rgba(255,85,0,0.05)' : 'var(--bg-elevated)',
                transition: 'all 150ms ease',
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-elevated)', border: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {t.logoUrl
                    ? <img src={t.logoUrl} alt={t.name} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: '0.7rem' }}>👥</span>}
                </div>
                <p style={{ fontSize: '0.72rem', fontWeight: 800, color: selectedTeamId === t.id ? 'var(--accent)' : 'var(--text-1)', whiteSpace: 'nowrap' }}>{t.name}</p>
              </div>
            ))}
          </div>

          {/* Player list */}
          <p style={powLabelStyle}>Player</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {players.length === 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', textAlign: 'center', padding: '16px 0' }}>No players in this team</p>
            )}
            {players.map(p => (
              <div key={p.id} onClick={() => setSelectedPlayerId(p.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', borderRadius: 10, cursor: 'pointer',
                border: selectedPlayerId === p.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: selectedPlayerId === p.id ? 'rgba(255,85,0,0.04)' : 'var(--bg-elevated)',
                transition: 'all 150ms ease',
              }}>
                <PlayerAvatar player={p} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-1)' }}>{p.name}</p>
                  {p.position && <PositionBadge position={p.position} small />}
                </div>
                <div style={{ width: 20, height: 20, borderRadius: '50%', border: selectedPlayerId === p.id ? 'none' : '2px solid var(--border)', background: selectedPlayerId === p.id ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {selectedPlayerId === p.id && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
                </div>
              </div>
            ))}
          </div>

          {/* Note */}
          <p style={powLabelStyle}>Note (optional)</p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Outstanding serve accuracy this weekend…"
            rows={2}
            style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: '0.85rem', color: 'var(--text-1)', padding: '10px 12px', fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box', marginBottom: 12, outline: 'none' }}
          />

          {existingPow && (
            <button onClick={handleClear} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', color: '#dc2626', fontWeight: 600, padding: '4px 0 8px', textAlign: 'center' }}>
              Remove Player of the Week
            </button>
          )}
        </div>

        {/* Sticky action buttons */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, flexShrink: 0, background: 'var(--bg-card)' }}>
          <button onClick={close} style={{ flex: 1, height: 46, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-2)' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !selectedTeamId || !selectedPlayerId}
            style={{ flex: 2, height: 46, borderRadius: 10, background: 'var(--accent)', border: 'none', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit', color: '#fff', opacity: (saving || !selectedTeamId || !selectedPlayerId) ? 0.6 : 1, boxShadow: '0 4px 14px rgba(255,85,0,0.3)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}

const powLabelStyle = { display: 'block', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }

const ShuffleIcon = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
  </svg>
)

function Field({ label, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</label>
      {children}
      {error && <p style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>{error}</p>}
    </div>
  )
}

const inputStyle = (error) => ({ width: '100%', height: 44, background: 'var(--bg-elevated)', border: `1px solid ${error ? '#dc2626' : 'var(--border)'}`, borderRadius: 8, padding: '0 12px', fontSize: '0.9rem', color: 'var(--text-1)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' })

const BackIcon   = () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
const EditIcon   = ({ size=16 }) => <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
const PlusIcon   = () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
const TrashIcon  = () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
const UploadIcon = () => <svg width="22" height="22" fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
const UserIcon   = () => <svg width="20" height="20" fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
