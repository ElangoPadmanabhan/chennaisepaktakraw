import { useEffect, useRef } from 'react'
import { getToken, onMessage, getMessaging, isSupported } from 'firebase/messaging'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { app, db } from '../firebase'
import { useAuth } from '../context/AuthContext'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY
const BASE      = import.meta.env.BASE_URL || '/'

// ── Singleton messaging instance (promise-based to prevent race condition) ──
let _messagingPromise = null
async function getMsg() {
  if (_messagingPromise) return _messagingPromise
  const supported = await isSupported()
  if (!supported) return null
  _messagingPromise = Promise.resolve(getMessaging(app))
  return _messagingPromise
}

// ── Single module-level foreground handler — shared across both setup paths ──
// This ensures only ONE onMessage handler is ever active at a time, preventing
// the double-notification bug where requestNotificationPermission + useNotifications
// both registered handlers that stacked up.
let _unsubForeground = null

function registerForegroundHandler(messaging) {
  if (_unsubForeground) _unsubForeground()   // tear down any existing handler first
  _unsubForeground = onMessage(messaging, payload => {
    const title = payload.notification?.title || '🏐 Match Live!'
    const body  = payload.notification?.body  || ''
    const url   = payload.data?.url
    const n = new Notification(title, {
      body,
      icon: `${BASE}icons/icon-192.png`,
      tag:  'match-live',  // tag dedupes OS-level — only one notification shown at a time
    })
    if (url) n.onclick = () => { window.focus(); window.location.href = url }
  })
  return _unsubForeground
}

// ── Called on app load: auto-setup if permission already granted ──
export function useNotifications() {
  const { user } = useAuth()
  const unsubRef = useRef(null)

  useEffect(() => {
    if (!user) return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    if (Notification.permission !== 'granted') return

    if (!VAPID_KEY) {
      console.warn('[notifications] VITE_FIREBASE_VAPID_KEY is not set — push notifications disabled')
      return
    }

    const setup = async () => {
      try {
        const messaging = await getMsg()
        if (!messaging) return

        const swReg = await navigator.serviceWorker.register(
          `${BASE}firebase-messaging-sw.js`, { scope: BASE }
        )

        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: swReg,
        })

        if (token) {
          try {
            await setDoc(doc(db, 'userTokens', user.uid), {
              token, uid: user.uid, updatedAt: serverTimestamp(),
            })
          } catch (saveErr) {
            console.warn('[notifications] Failed to save token to Firestore — user will not receive push notifications:', saveErr)
          }
        }

        unsubRef.current = registerForegroundHandler(messaging)
      } catch (err) {
        console.warn('[notifications] Setup failed:', err)
      }
    }

    setup()
    return () => {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
      // Also clear the module-level handler so it doesn't fire after logout
      if (_unsubForeground) { _unsubForeground(); _unsubForeground = null }
    }
  }, [user?.uid])
}

// ── Called from Profile button (user gesture — browser always allows) ──
export async function requestNotificationPermission(uid) {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported'

    if (!VAPID_KEY) {
      console.warn('[notifications] VITE_FIREBASE_VAPID_KEY is not set')
      return 'error'
    }

    const messaging = await getMsg()
    if (!messaging) return 'unsupported'

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return permission

    const swReg = await navigator.serviceWorker.register(
      `${BASE}firebase-messaging-sw.js`, { scope: BASE }
    )

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    })

    if (token && uid) {
      try {
        await setDoc(doc(db, 'userTokens', uid), {
          token, uid, updatedAt: serverTimestamp(),
        })
      } catch (saveErr) {
        console.warn('[notifications] Token save failed — push notifications may not work:', saveErr)
        // Return a distinct status so the UI can warn the user
        return 'token_save_failed'
      }
    }

    // Register foreground handler via shared function — replaces any existing one
    registerForegroundHandler(messaging)

    return 'granted'
  } catch (err) {
    console.warn('[notifications] Permission request failed:', err)
    return 'error'
  }
}
