/* Treasury push-notification integration for Firebase JS SDK 10.14.1 (modular).
 * Load this AFTER index.html has initialized the default Firebase app.
 * Replace the two placeholders below before deploying.
 */
import { getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase, ref, set, get, onValue } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

const VAPID_PUBLIC_KEY = 'BNLPOM6cPznme7eu5MP2n8imLOd32wIOpH5mZG1lZyfNN4xvjd_dd_nRBT7Az9Z8d10LaBu07EIk8yCDViQlwB0';
const PUSH_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwJ3ZDGXsZ8emoiPJo5qw8l5_UVvFf6Kk-lb0AsJD-hc9W8i4CYfKl3CFc7r0IFprz9/exec';

const app = getApp();
const auth = getAuth(app);
const db = getDatabase(app);
let currentUser = null;
let currentProfile = null;
let messagingInstance = null;
let globalSoundSettings = {enabled: true, sound: 'chime'};
let stopSettingsListener = null;
let soundListenerInstalled = false;
let audioContext = null;

const VALID_SOUNDS = new Set(['chime', 'bell', 'double', 'none']);

function statusMessage(id, message) {
  const node = document.getElementById(id);
  if (node) node.textContent = message;
}

function getSoundValue(value) {
  return VALID_SOUNDS.has(value) ? value : 'chime';
}

async function tokenKeyForToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioContext) audioContext = new Ctx();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch (err) {
    // A sound is optional; notifications still work if audio is unavailable.
  }
}

function playTone(frequency, startAt, duration, waveform) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const start = audioContext.currentTime + startAt;
  oscillator.type = waveform || 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.055, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playNotificationSound(soundName) {
  const sound = getSoundValue(soundName || globalSoundSettings.sound);
  if (!globalSoundSettings.enabled || sound === 'none') return;
  unlockAudio();
  if (!audioContext) return;
  if (sound === 'bell') {
    playTone(740, 0, 0.22, 'sine');
    playTone(988, 0.045, 0.28, 'sine');
  } else if (sound === 'double') {
    playTone(880, 0, 0.12, 'triangle');
    playTone(880, 0.19, 0.12, 'triangle');
  } else {
    playTone(880, 0, 0.14, 'sine');
    playTone(1175, 0.10, 0.22, 'sine');
  }
}

async function getMessagingInstance() {
  if (messagingInstance) return messagingInstance;
  const supported = await isSupported();
  if (!supported) throw new Error('Push notifications are not supported by this browser.');
  messagingInstance = getMessaging(app);
  if (!soundListenerInstalled) {
    // Sound-only listener. Your existing onMessage/toast handler is left untouched.
    onMessage(messagingInstance, (payload) => {
      const data = payload && payload.data ? payload.data : {};
      if (data.soundEnabled === 'false' || data.sound === 'none') return;
      playNotificationSound(data.sound || globalSoundSettings.sound);
    });
    soundListenerInstalled = true;
  }
  return messagingInstance;
}

function refreshSoundSettingsUI() {
  const panel = document.getElementById('treasuryGlobalSoundSettings');
  if (panel) panel.hidden = !(currentProfile && currentProfile.level === 'master');
  const enabled = document.getElementById('treasuryGlobalSoundEnabled');
  const sound = document.getElementById('treasuryGlobalSoundChoice');
  if (enabled) enabled.checked = globalSoundSettings.enabled;
  if (sound) sound.value = getSoundValue(globalSoundSettings.sound);
}

async function saveGlobalSoundSettings() {
  if (!currentUser || !currentProfile || currentProfile.level !== 'master') {
    throw new Error('Only the master account can change the global notification sound.');
  }
  const enabledControl = document.getElementById('treasuryGlobalSoundEnabled');
  const soundControl = document.getElementById('treasuryGlobalSoundChoice');
  const sound = getSoundValue(soundControl ? soundControl.value : globalSoundSettings.sound);
  const enabled = !!(enabledControl && enabledControl.checked) && sound !== 'none';
  const config = {enabled, sound, updatedAt: Date.now(), updatedBy: currentUser.uid};
  await set(ref(db, 'treasury/settings/notifications'), config);
  globalSoundSettings = {enabled: config.enabled, sound: config.sound};
  refreshSoundSettingsUI();
  statusMessage('treasuryGlobalSoundStatus', 'Saved. This setting applies to all signed-in users.');
}

async function enableNotifications() {
  if (!currentUser) throw new Error('Sign in to Treasury first.');
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('This browser does not support web push notifications.');
  }
  if (VAPID_PUBLIC_KEY.indexOf('PASTE_') === 0) throw new Error('Add your Firebase Web Push VAPID public key in treasury-push-integration.js first.');
  if (PUSH_WEB_APP_URL.indexOf('PASTE_') === 0) throw new Error('Deploy Code.gs as a web app and add its URL in treasury-push-integration.js first.');

  unlockAudio(); // User gesture unlocks foreground sound where browser policy allows it.
  let permission = Notification.permission;
  if (permission !== 'granted') permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const workerUrl = new URL('./firebase-messaging-sw.js', window.location.href);
  const scope = new URL('./', window.location.href).pathname;
  const registration = await navigator.serviceWorker.register(workerUrl.href, {scope});
  const messaging = await getMessagingInstance();
  const token = await getToken(messaging, {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: registration
  });
  if (!token) throw new Error('Firebase did not return a push token. Check your VAPID key and Firebase Messaging setup.');

  // Store under a deterministic SHA-256 key so the raw token is not used as a database key.
  const tokenKey = await tokenKeyForToken(token);
  await set(ref(db, `pushTokens/${currentUser.uid}/${tokenKey}`), token);
  statusMessage('treasuryPushStatus', 'Notifications enabled on this device.');
  return true;
}

async function postPushRequest(action, extras = {}) {
  if (!currentUser) throw new Error('Sign in to Treasury first.');
  if (PUSH_WEB_APP_URL.indexOf('PASTE_') === 0) throw new Error('Set the Apps Script web app URL first.');
  const idToken = await currentUser.getIdToken();
  // text/plain is a CORS-safelisted content type; no-cors is used because Apps Script
  // ContentService does not provide configurable CORS response headers. The body is
  // authenticated by Firebase ID token on the server. The opaque response is expected.
  await fetch(PUSH_WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    redirect: 'follow',
    headers: {'Content-Type': 'text/plain;charset=UTF-8'},
    body: JSON.stringify({idToken, action, ...extras})
  });
}

async function sendTestNotification() {
  await postPushRequest('test');
  statusMessage('treasuryPushStatus', 'Test request sent. Check this device; if nothing arrives, inspect Apps Script → Executions.');
}

async function notifyBroadcast() {
  return postPushRequest('broadcast');
}

async function notifyDirect(toUid, pairId) {
  if (!toUid) throw new Error('A direct-message recipient UID is required.');
  const expectedPair = [currentUser.uid, String(toUid)].sort().join('_');
  return postPushRequest('direct', {toUid: String(toUid), pairId: pairId || expectedPair});
}

async function notifyEvent(eventId) {
  if (!eventId) throw new Error('An event ID is required.');
  return postPushRequest('event', {eventId: String(eventId)});
}

function previewSelectedSound() {
  const enabled = document.getElementById('treasuryGlobalSoundEnabled');
  const sound = document.getElementById('treasuryGlobalSoundChoice');
  globalSoundSettings = {
    enabled: enabled ? enabled.checked : true,
    sound: getSoundValue(sound ? sound.value : globalSoundSettings.sound)
  };
  if (globalSoundSettings.sound !== 'none') {
    unlockAudio();
    playNotificationSound(globalSoundSettings.sound);
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentProfile = null;
  if (stopSettingsListener) {
    stopSettingsListener();
    stopSettingsListener = null;
  }
  if (!user) {
    refreshSoundSettingsUI();
    return;
  }

  try {
    const profileSnapshot = await get(ref(db, `users/${user.uid}`));
    currentProfile = profileSnapshot.val() || null;
  } catch (err) {
    currentProfile = null;
  }

  stopSettingsListener = onValue(ref(db, 'treasury/settings/notifications'), (snapshot) => {
    const value = snapshot.val() || {};
    const sound = getSoundValue(value.sound);
    globalSoundSettings = {enabled: value.enabled !== false && sound !== 'none', sound};
    refreshSoundSettingsUI();
  });
  refreshSoundSettingsUI();
  // Install the sound-only foreground listener when supported. Failure here should
  // not block sign-in or the rest of Treasury.
  getMessagingInstance().catch((err) => console.info('Treasury push sound listener unavailable:', err.message));
});

window.TreasuryPush = Object.freeze({
  enableNotifications,
  sendTestNotification,
  notifyBroadcast,
  notifyDirect,
  notifyEvent,
  saveGlobalSoundSettings,
  previewSelectedSound
});

function wirePushSettingsControls() {
  const enable = document.getElementById('treasuryEnablePushBtn');
  const test = document.getElementById('treasuryTestPushBtn');
  const save = document.getElementById('treasurySaveGlobalSoundBtn');
  const preview = document.getElementById('treasuryPreviewSoundBtn');
  if (enable) enable.addEventListener('click', () => enableNotifications().catch(err => statusMessage('treasuryPushStatus', err.message)));
  if (test) test.addEventListener('click', () => sendTestNotification().catch(err => statusMessage('treasuryPushStatus', err.message)));
  if (save) save.addEventListener('click', () => saveGlobalSoundSettings().catch(err => statusMessage('treasuryGlobalSoundStatus', err.message)));
  if (preview) preview.addEventListener('click', previewSelectedSound);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wirePushSettingsControls);
else wirePushSettingsControls();
