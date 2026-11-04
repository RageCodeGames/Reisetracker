/**
 * Push-Abo der Eltern-App. Erlaubnis nur nach Antippen.
 * Ohne pushWorker / vapidPublicKey in config.json passiert nichts.
 */

import { familyPushToken } from './crypto.js';

export function pushKonfigOk(konfig) {
  return Boolean(konfig?.pushWorker && konfig?.vapidPublicKey);
}

export function istIos() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function istInstalliert() {
  if (window.navigator.standalone === true) return true;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch {
    // Alte Browser ohne matchMedia.
  }
  return false;
}

export async function pushIstAn() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

export async function pushAktivieren(konfig, key) {
  if (!pushKonfigOk(konfig)) throw new Error('push-aus');
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('push-fehlt');
  }
  if (istIos() && !istInstalliert()) throw new Error('ios-install');
  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== 'granted') throw new Error('push-erlaubnis');
  const reg = await navigator.serviceWorker.ready;
  const vorhanden = await reg.pushManager.getSubscription();
  const sub = vorhanden || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidAlsBytes(konfig.vapidPublicKey),
  });
  const token = await familyPushToken(key);
  const antwort = await fetch(workerUrl(konfig.pushWorker, '/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, subscription: sub }),
  });
  if (!antwort.ok) throw new Error('push-server');
  return true;
}

export async function pushAusschalten(konfig, key) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  if (pushKonfigOk(konfig) && key) {
    try {
      const token = await familyPushToken(key);
      await fetch(workerUrl(konfig.pushWorker, '/unsubscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, subscription: { endpoint: sub.endpoint } }),
      });
    } catch {
      // Server nicht erreichbar: lokal trotzdem abmelden.
    }
  }
  await sub.unsubscribe();
}

function workerUrl(basis, pfad) {
  const url = new URL(basis, document.baseURI);
  const stamm = url.href.replace(/\/+$/, '');
  return `${stamm}${pfad}`;
}

function vapidAlsBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = `${base64url}${pad}`.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
