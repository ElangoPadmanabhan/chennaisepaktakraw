import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { Avatar } from './TopBar'
import { useSupportedTeam } from '../hooks/useSupportedTeam'
import { hardRefresh } from './UpdateBanner'
import { requestNotificationPermission } from '../hooks/useNotifications'

export default function ProfileSheet({ open, onClose }) {
  const { user, isAdmin, adminLogout, userLogout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { supportedTeam } = useSupportedTeam()
  const isDark = theme === 'dark'
  const [refreshing, setRefreshing]   = useState(false)
  const [notifState, setNotifState]   = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  ) // 'default' | 'granted' | 'denied' | 'unsupported'
  const [enablingNotif, setEnablingNotif] = useState(false)

  const handleSignOut = async () => {
    onClose()
    if (isAdmin) adminLogout()
    else await userLogout()
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await hardRefresh()
  }

  const handleEnableNotifications = async () => {
    if (notifState === 'denied') return
    setEnablingNotif(true)
    const result = await requestNotificationPermission(user?.uid)
    setNotifState(result === 'error' ? 'default' : result)
    setEnablingNotif(false)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 300,
          animation: 'fadeIn 180ms ease',
        }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        background: 'var(--bg-card)',
        borderRadius: '24px 24px 0 0',
        border: '1px solid var(--border)',
        borderBottom: 'none',
        zIndex: 301,
        animation: 'slideUp 220ms cubic-bezier(0.32,0.72,0,1)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>

        {/* Profile header */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '16px 24px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <Avatar user={user} isAdmin={isAdmin} size={72} />
          <h2 style={{ fontWeight: 800, fontSize: '1.15rem', marginTop: 12, textAlign: 'center' }}>
            {isAdmin ? 'Admin' : user?.displayName || 'User'}
          </h2>
          <p style={{ color: 'var(--text-2)', fontSize: '0.82rem', marginTop: 3, textAlign: 'center' }}>
            {isAdmin ? 'Score manager · Chennai ST League' : user?.email}
          </p>

          {/* Role badge */}
          <span style={{
            marginTop: 10,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 12px', borderRadius: 20,
            background: isAdmin ? 'rgba(255,85,0,0.1)' : 'rgba(34,197,94,0.1)',
            border: `1px solid ${isAdmin ? 'rgba(255,85,0,0.25)' : 'rgba(34,197,94,0.25)'}`,
            fontSize: '0.72rem', fontWeight: 700,
            color: isAdmin ? 'var(--accent)' : 'var(--success)',
          }}>
            {isAdmin ? '⚡ Admin Access' : '👤 Viewer'}
          </span>
        </div>

        {/* Info rows */}
        <div style={{ padding: '8px 0' }}>

          {/* Supported team — users only */}
          {!isAdmin && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 24px',
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'rgba(255,85,0,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.1rem', flexShrink: 0,
              }}>❤️</div>
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                  Supporting
                </p>
                <p style={{ fontWeight: 700, fontSize: '0.92rem', color: supportedTeam ? 'var(--text-1)' : 'var(--text-3)' }}>
                  {supportedTeam ? supportedTeam.charAt(0).toUpperCase() + supportedTeam.slice(1) + ' Team' : 'No team selected'}
                </p>
              </div>
            </div>
          )}

          {/* Google account — users only */}
          {!isAdmin && user?.photoURL && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 24px',
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: '#f0f4ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <GoogleColorIcon />
              </div>
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                  Signed in via
                </p>
                <p style={{ fontWeight: 700, fontSize: '0.92rem' }}>Google</p>
              </div>
            </div>
          )}

          {/* Enable notifications — not shown if unsupported */}
          {notifState !== 'unsupported' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 24px',
              borderBottom: '1px solid var(--border)',
              cursor: notifState === 'denied' ? 'not-allowed' : 'pointer',
              opacity: enablingNotif ? 0.5 : 1,
            }} onClick={notifState !== 'granted' ? handleEnableNotifications : undefined}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: notifState === 'granted' ? 'rgba(22,163,74,0.08)' : 'rgba(255,85,0,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.1rem', flexShrink: 0,
              }}>
                {notifState === 'granted' ? '🔔' : notifState === 'denied' ? '🔕' : '🔔'}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                  Match Alerts
                </p>
                <p style={{ fontWeight: 700, fontSize: '0.92rem', color: notifState === 'granted' ? 'var(--success)' : notifState === 'denied' ? 'var(--text-3)' : 'var(--text-1)' }}>
                  {enablingNotif       ? 'Enabling…'
                   : notifState === 'granted' ? '✓ Notifications On'
                   : notifState === 'denied'  ? 'Blocked by browser'
                   : 'Enable Notifications'}
                </p>
                {notifState === 'denied' && (
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 2 }}>
                    Allow in browser site settings
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Dark mode toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 24px',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
          }} onClick={toggleTheme}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: isDark ? 'rgba(255,210,60,0.12)' : 'rgba(99,102,241,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', flexShrink: 0,
            }}>{isDark ? '🌙' : '☀️'}</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                Appearance
              </p>
              <p style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                {isDark ? 'Dark Mode' : 'Light Mode'}
              </p>
            </div>
            {/* Toggle pill */}
            <div style={{
              width: 44, height: 26, borderRadius: 13,
              background: isDark ? 'var(--accent)' : 'var(--border)',
              position: 'relative', flexShrink: 0,
              transition: 'background 200ms ease',
            }}>
              <div style={{
                position: 'absolute', top: 3,
                left: isDark ? 21 : 3,
                width: 20, height: 20, borderRadius: '50%',
                background: '#fff',
                transition: 'left 200ms ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
          </div>

          {/* Clear cache & refresh */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 24px',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer', opacity: refreshing ? 0.5 : 1,
          }} onClick={handleRefresh}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'rgba(99,102,241,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', flexShrink: 0,
            }}>🔄</div>
            <div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                App
              </p>
              <p style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                {refreshing ? 'Refreshing…' : 'Clear Cache & Refresh'}
              </p>
            </div>
          </div>

          {/* Sign out */}
          <div style={{ padding: '12px 24px' }}>
            <button
              onClick={handleSignOut}
              style={{
                width: '100%', height: 50,
                background: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.2)',
                borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: 700, fontSize: '0.92rem',
                color: '#dc2626',
                transition: 'background 150ms ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(220,38,38,0.06)'}
            >
              <SignOutIcon />
              Sign Out
            </button>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateX(-50%) translateY(100%) } to { transform: translateX(-50%) translateY(0) } }
      `}</style>
    </>
  )
}

function GoogleColorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}
