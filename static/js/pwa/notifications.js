/**
 * Notification preferences.
 *
 * Push notifications need a backend push service (Web Push + VAPID keys) that
 * does not exist yet. This module requests browser permission and stores the
 * preference; `subscribePush()` is ready to send the subscription to FastAPI
 * once APP.vapidPublicKey is configured. No push messages are faked.
 */

import { APP } from '../config.js';
import { settings } from '../core/settings.js';

export const notifications = {
  get supported() {
    return 'Notification' in window && 'serviceWorker' in navigator;
  },
  get permission() {
    return this.supported ? Notification.permission : 'unsupported';
  },
  get pushReady() {
    return !!APP.vapidPublicKey && 'PushManager' in window;
  },

  async enable() {
    if (!this.supported) return { ok: false, reason: 'This browser does not support notifications.' };
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      settings.update({ notifications: false });
      return { ok: false, reason: 'Notification permission was blocked. Allow it in your browser settings.' };
    }
    settings.update({ notifications: true });
    if (this.pushReady) await subscribePush();
    return { ok: true };
  },

  disable() {
    settings.update({ notifications: false });
  },

  /** Shows a local notification through the service worker (not a push). */
  async showLocal(title, body) {
    if (!settings.get('notifications') || this.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return false;
    await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'cm-local' });
    return true;
  },
};

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Subscribe to Web Push and register the subscription with the backend. */
export async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(APP.vapidPublicKey),
  });
  await fetch(`${APP.apiBase}/api/v1/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  return sub;
}
