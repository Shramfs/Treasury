/* TREASURY — background push service worker.
 * Must be deployed at the SITE ROOT (same folder as index.html), e.g.
 *   https://yourname.github.io/Treasury/firebase-messaging-sw.js
 * NOT inside a subfolder — browsers require this for push scope to work.
 *
 * This file only runs when the app is in the background or closed.
 * Foreground (tab open) notifications are handled inside index.html instead,
 * via onMessage(), and shown as the existing in-app toast.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Keep this identical to firebaseConfig in index.html.
firebase.initializeApp({
  apiKey: "AIzaSyBYUzthxPw_K2Djv7mWTu6q5TzmDWwPsQ0",
  authDomain: "treasury-52334.firebaseapp.com",
  projectId: "treasury-52334",
  appId: "1:469961144588:web:9f8d04daed3b0d61537129",
  databaseURL: "https://treasury-52334-default-rtdb.europe-west1.firebasedatabase.app",
  messagingSenderId: "469961144588" // verify against Firebase console > Project settings > Cloud Messaging
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || d.title || 'Treasury';
  const body = n.body || d.body || '';
  self.registration.showNotification(title, {
    body,
    icon: undefined, // optionally point this at a 192x192 PNG hosted on your site
    badge: undefined,
    data: { url: d.url || '/' },
    tag: d.tag || undefined
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
