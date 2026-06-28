importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey:            '__VITE_FIREBASE_API_KEY__',
  authDomain:        '__VITE_FIREBASE_AUTH_DOMAIN__',
  projectId:         '__VITE_FIREBASE_PROJECT_ID__',
  storageBucket:     '__VITE_FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__VITE_FIREBASE_MESSAGING_SENDER_ID__',
  appId:             '__VITE_FIREBASE_APP_ID__',
})

const messaging = firebase.messaging()

// Derive base path from the service worker's own location rather than hardcoding
// e.g. if SW is at /chennaisepaktakraw/firebase-messaging-sw.js, base = /chennaisepaktakraw/
const SW_BASE = self.location.pathname.replace('firebase-messaging-sw.js', '')
const DEFAULT_URL  = SW_BASE || '/'
const ICON_URL     = `${SW_BASE}icons/icon-192.png`

// Handle background / app-closed push messages
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || '🏐 Match Live!'
  const body  = payload.notification?.body  || 'A match is starting now.'
  const url   = payload.data?.url || DEFAULT_URL

  self.registration.showNotification(title, {
    body,
    icon:    ICON_URL,
    badge:   ICON_URL,
    tag:     'match-live',
    data:    { url },
    vibrate: [200, 100, 200],
  })
})

// Tap notification → open the match scoring page
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || DEFAULT_URL
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(SW_BASE))
      if (existing) { existing.focus(); existing.navigate(url) }
      else clients.openWindow(url)
    })
  )
})
