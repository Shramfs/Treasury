/* TREASURY — background Firebase Cloud Messaging service worker.
 * Place next to index.html, e.g. /Treasury/firebase-messaging-sw.js.
 * This worker only displays generic push notices; it never decrypts or reads chats.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBYUzthxPw_K2Djv7mWTu6q5TzmDWwPsQ0',
  authDomain: 'treasury-52334.firebaseapp.com',
  projectId: 'treasury-52334',
  appId: '1:469961144588:web:9f8d04daed3b0d61537129',
  databaseURL: 'https://treasury-52334-default-rtdb.europe-west1.firebasedatabase.app',
  messagingSenderId: '469961144588'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // FCM automatically displays notification-payload messages in the background.
  // Our Apps Script relay sends data-only messages, so manually display those once.
  if (payload && payload.notification) return;

  const data = (payload && payload.data) || {};
  const title = String(data.title || 'Treasury').slice(0, 100);
  const body = String(data.body || '').slice(0, 240);
  const options = {
    body,
    data: {
      url: data.url || './',
      type: data.type || 'general',
      tag: data.tag || ''
    },
    tag: data.tag || undefined
  };

  // The Notification API does not offer arbitrary custom sound files.
  // It can request silence; otherwise, the browser/device uses its own default.
  if (data.soundEnabled === 'false' || data.sound === 'none') options.silent = true;

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const base = self.registration.scope;
    let target = new URL((event.notification.data && event.notification.data.url) || './', base);
    const appOrigin = new URL(base).origin;
    if (target.origin !== appOrigin) target = new URL('./', base);

    const windows = await clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of windows) {
      if (new URL(client.url).origin !== appOrigin) continue;
      if ('navigate' in client && client.url !== target.href) {
        try { await client.navigate(target.href); } catch (err) { /* focus below */ }
      }
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(target.href);
  })());
});
