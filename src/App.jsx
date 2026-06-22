import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { useNotifications } from './hooks/useNotifications'
import Navbar from './components/Navbar'
import UpdateBanner from './components/UpdateBanner'
import LoginPage from './pages/LoginPage'
import Home from './pages/Home'
import Scoring from './pages/Scoring'
import LeagueTable from './pages/LeagueTable'
import Fixtures from './pages/Fixtures'
import ManageLeagues from './pages/ManageLeagues'
import LeagueDetail from './pages/LeagueDetail'
import Teams from './pages/Teams'

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, isAdmin, loading } = useAuth()
  if (loading) return <Splash />
  if (!user && !isAdmin) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return children
}

function Splash() {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <div style={{ textAlign: 'center' }}>
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" width={72} style={{ objectFit: 'contain', marginBottom: 16 }}
          onError={e => { e.currentTarget.style.display = 'none' }} />
        <p style={{ color: 'var(--text-2)', fontSize: '0.9rem' }}>Loading…</p>
      </div>
    </div>
  )
}

const LOGO_BG = `${import.meta.env.BASE_URL}home-logo.jpg`

function AppInner() {
  const { user, isAdmin, loading } = useAuth()
  const { theme } = useTheme()
  useNotifications()
  if (loading) return <Splash />
  const isAuthed = user || isAdmin

  return (
    <>
      {/* Global logo watermark */}
      <img
        src={LOGO_BG}
        alt=""
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '75vw',
          maxWidth: 420,
          opacity: 0.08,
          mixBlendMode: theme === 'dark' ? 'screen' : 'multiply',
          pointerEvents: 'none',
          zIndex: 0,
          userSelect: 'none',
        }}
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
      <Routes>
        <Route path="/login"          element={isAuthed ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/"               element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/scoring"                               element={<ProtectedRoute><Scoring /></ProtectedRoute>} />
        <Route path="/scoring/:leagueId/:fixtureId"          element={<ProtectedRoute><Scoring /></ProtectedRoute>} />
        <Route path="/table"          element={<ProtectedRoute><LeagueTable /></ProtectedRoute>} />
        <Route path="/fixtures"       element={<ProtectedRoute><Fixtures /></ProtectedRoute>} />
        <Route path="/teams"          element={<ProtectedRoute><Teams /></ProtectedRoute>} />
        <Route path="/admin/leagues"           element={<ProtectedRoute adminOnly><ManageLeagues /></ProtectedRoute>} />
        <Route path="/admin/leagues/:leagueId" element={<ProtectedRoute adminOnly><LeagueDetail /></ProtectedRoute>} />
        <Route path="*"               element={<Navigate to="/" replace />} />
      </Routes>
      {isAuthed && <Navbar />}
      <UpdateBanner />
    </>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  )
}
