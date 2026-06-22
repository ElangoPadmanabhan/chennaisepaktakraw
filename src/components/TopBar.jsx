import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import ProfileSheet from './ProfileSheet'

function SunIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  )
}

export default function TopBar() {
  const { user, isAdmin } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const isDark = theme === 'dark'

  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px 0',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'var(--bg-base)',
      }}>
        {/* League name */}
        <p style={{
          fontSize: '0.7rem', fontWeight: 800,
          letterSpacing: '1px', textTransform: 'uppercase',
          color: 'var(--accent)',
        }}>
          Chennai ST League
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 20,
              border: '1.5px solid var(--border)',
              background: isDark ? 'var(--bg-elevated)' : 'var(--bg-card)',
              color: isDark ? '#f0c040' : 'var(--text-2)',
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '0.65rem', fontWeight: 700,
              transition: 'all 200ms ease',
              minHeight: 32,
            }}
          >
            {isDark ? <MoonIcon /> : <SunIcon />}
            {isDark ? 'Dark' : 'Light'}
          </button>

          {/* Profile avatar button */}
          <button
            onClick={() => setOpen(true)}
            aria-label="Open profile"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, borderRadius: '50%',
              transition: 'transform 120ms ease',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <Avatar user={user} isAdmin={isAdmin} size={38} />
          </button>
        </div>
      </div>

      <ProfileSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function Avatar({ user, isAdmin, size = 36 }) {
  const [imgError, setImgError] = useState(false)

  const initials = isAdmin
    ? 'A'
    : (user?.displayName || user?.email || '?')[0].toUpperCase()

  const showPhoto = !isAdmin && user?.photoURL && !imgError

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {showPhoto ? (
        <img
          src={user.photoURL}
          alt={user.displayName || 'Profile'}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          style={{
            width: size, height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            border: '2px solid var(--accent)',
            display: 'block',
          }}
        />
      ) : (
        <div style={{
          width: size, height: size, borderRadius: '50%',
          background: isAdmin ? 'var(--accent)' : 'var(--accent-mid)',
          border: `2px solid var(--accent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800,
          fontSize: size * 0.38,
          color: isAdmin ? '#fff' : 'var(--accent)',
        }}>
          {initials}
        </div>
      )}
      {/* Online dot */}
      <span style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 10, height: 10, borderRadius: '50%',
        background: 'var(--success)',
        border: '2px solid var(--bg-base)',
      }} />
    </div>
  )
}
