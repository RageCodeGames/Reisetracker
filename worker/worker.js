/**
 * Cloudflare Worker: Web-Push für den Reisetracker.
 *
 * Einrichtung im Cloudflare-Dashboard, Schritt für Schritt:
 *
 * 1. Workers & Pages → Create → "Create Worker". Namen z. B. reisetracker-push.
 *    ES-Modul / Module Worker wählen (nicht Service Worker).
 * 2. Diesen ganzen Dateiinhalt in den Editor kopieren und Deploy klicken.
 * 3. Workers → der Worker → Settings → Bindings → Add → KV Namespace.
 *    - Neuen Namespace anlegen (z. B. reisetracker-subs).
 *    - Variable name genau: SUBS
 *    - Speichern.
 * 4. Settings → Variables and Secrets → Add (jeweils Encrypt / Secret):
 *    - VAPID_PUBLIC_KEY   Public Key aus: node tools/vapid.mjs
 *    - VAPID_PRIVATE_KEY  Private Key aus demselben Aufruf (nie ins Repo)
 *    - VAPID_SUBJECT      z. B. mailto:deine@adresse.de
 *    - NOTIFY_SECRET      langes Zufallswort; dasselbe in der Upload-Seite
 *    - FAMILY_PUSH_TOKEN  aus der Upload-Seite nach dem Familien-Passwort kopieren
 * 5. Nochmal Deploy. Die Worker-URL (https://….workers.dev) nach
 *    config.json → "pushWorker" eintragen. Public Key nach "vapidPublicKey".
 *
 * Keine npm-Pakete. Nur WebCrypto. CORS nur für GitHub Pages.
 */

const ERLAUBTE_ORIGINS = [
  'https://ragecodegames.github.io',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
];

export default {
  async fetch(anfrage, env) {
    const cors = corsKoepfe(anfrage);
    const methode = anfrage.method || 'GET';
    const pfad = pfadNormalisieren(new URL(anfrage.url).pathname);
    let status = 500;

    try {
      // Preflight: immer 204, CORS wenn Origin erlaubt.
      if (methode === 'OPTIONS') {
        status = 204;
        return antwortMitLog(methode, pfad, status, new Response(null, {
          status: 204,
          headers: {
            ...(cors || {}),
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        }));
      }

      if (methode === 'GET' && pfad === '/health') {
        status = 200;
        return antwortMitLog(methode, pfad, status, new Response('ok', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            ...(cors || {}),
          },
        }));
      }

      const postRouten = {
        '/subscribe': abonnieren,
        '/unsubscribe': abbestellen,
        '/notify': benachrichtigen,
      };

      if (pfad in postRouten) {
        if (methode !== 'POST') {
          status = 405;
          return antwortMitLog(methode, pfad, status, jsonAntwort(
            { fehler: 'method' },
            405,
            cors,
            { Allow: 'POST, OPTIONS' },
          ));
        }
        const daten = await postRouten[pfad](anfrage, env);
        status = 200;
        return antwortMitLog(methode, pfad, status, jsonAntwort(daten, 200, cors));
      }

      status = 404;
      return antwortMitLog(methode, pfad, status, jsonAntwort({ fehler: 'unbekannt' }, 404, cors));
    } catch (problem) {
      status = problem.status || 500;
      return antwortMitLog(
        methode,
        pfad,
        status,
        jsonAntwort({ fehler: problem.message || 'fehler' }, status, cors),
      );
    }
  },
};

/** /subscribe und /subscribe/ → /subscribe */
function pfadNormalisieren(pathname) {
  let pfad = String(pathname || '/');
  if (pfad.length > 1) pfad = pfad.replace(/\/+$/, '');
  if (!pfad.startsWith('/')) pfad = `/${pfad}`;
  return pfad || '/';
}

function corsKoepfe(anfrage) {
  const origin = anfrage.headers.get('Origin') || '';
  if (!ERLAUBTE_ORIGINS.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonAntwort(objekt, status, cors, extra = {}) {
  return new Response(JSON.stringify(objekt), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(cors || {}),
      ...extra,
    },
  });
}

function antwortMitLog(methode, pfad, status, antwort) {
  console.log(`${methode} ${pfad} → ${status}`);
  return antwort;
}

async function jsonBody(anfrage) {
  try {
    return await anfrage.json();
  } catch {
    const problem = new Error('body');
    problem.status = 400;
    throw problem;
  }
}

function tokenPruefen(body, env) {
  const token = String(body?.token || '');
  if (!env.FAMILY_PUSH_TOKEN || token !== env.FAMILY_PUSH_TOKEN) {
    const problem = new Error('token');
    problem.status = 403;
    throw problem;
  }
}

function aboPruefen(sub) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    const problem = new Error('subscription');
    problem.status = 400;
    throw problem;
  }
}

async function endpointSchluessel(endpoint) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function abonnieren(anfrage, env) {
  const body = await jsonBody(anfrage);
  tokenPruefen(body, env);
  aboPruefen(body.subscription);
  const id = await endpointSchluessel(body.subscription.endpoint);
  await env.SUBS.put(id, JSON.stringify(body.subscription));
  return { ok: true };
}

async function abbestellen(anfrage, env) {
  const body = await jsonBody(anfrage);
  tokenPruefen(body, env);
  const endpoint = body.subscription?.endpoint || body.endpoint;
  if (!endpoint) {
    const problem = new Error('subscription');
    problem.status = 400;
    throw problem;
  }
  const id = await endpointSchluessel(endpoint);
  await env.SUBS.delete(id);
  return { ok: true };
}

async function benachrichtigen(anfrage, env) {
  const auth = anfrage.headers.get('Authorization') || '';
  const erwartet = `Bearer ${env.NOTIFY_SECRET || ''}`;
  if (!env.NOTIFY_SECRET || auth !== erwartet) {
    const problem = new Error('secret');
    problem.status = 403;
    throw problem;
  }
  const body = await jsonBody(anfrage);
  const title = String(body.title || 'Neuer Gruß');
  const text = String(body.body || 'Jetzt im Reisetracker ansehen');
  let gesendet = 0;
  let fehlgeschlagen = 0;
  let cursor;
  do {
    const liste = await env.SUBS.list({ cursor });
    for (const eintrag of liste.keys) {
      const roh = await env.SUBS.get(eintrag.name);
      if (!roh) continue;
      let sub;
      try {
        sub = JSON.parse(roh);
      } catch {
        await env.SUBS.delete(eintrag.name);
        fehlgeschlagen += 1;
        continue;
      }
      try {
        const antwort = await webPushSenden(sub, { title, body: text }, env);
        if (antwort.status === 404 || antwort.status === 410) {
          await env.SUBS.delete(eintrag.name);
          fehlgeschlagen += 1;
        } else if (!antwort.ok) {
          fehlgeschlagen += 1;
        } else {
          gesendet += 1;
        }
      } catch {
        fehlgeschlagen += 1;
      }
    }
    cursor = liste.list_complete ? undefined : liste.cursor;
  } while (cursor);
  return { gesendet, fehlgeschlagen };
}

/** Web Push: VAPID-JWT (RFC 8292) + aes128gcm (RFC 8291 / RFC 8188). */
async function webPushSenden(sub, payload, env) {
  const koerper = await aes128gcm(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const jwt = await vapidJwt(sub.endpoint, env);
  const antwort = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: koerper,
  });
  return antwort;
}

async function vapidJwt(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const kopf = { typ: 'JWT', alg: 'ES256' };
  const jetzt = Math.floor(Date.now() / 1000);
  const claims = {
    aud,
    exp: jetzt + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:reisetracker@localhost',
  };
  const unsigned = `${jsonB64(kopf)}.${jsonB64(claims)}`;
  const key = await vapidKeyImport(env);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  ));
  return `${unsigned}.${bytesB64url(sig)}`;
}

async function vapidKeyImport(env) {
  const pub = b64urlBytes(env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('vapid-public');
  const x = bytesB64url(pub.subarray(1, 33));
  const y = bytesB64url(pub.subarray(33, 65));
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x,
      y,
      d: env.VAPID_PRIVATE_KEY,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function aes128gcm(klartext, p256dhB64, authB64) {
  const uaPublic = b64urlBytes(p256dhB64);
  const auth = b64urlBytes(authB64);
  const lokal = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', lokal.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey },
    lokal.privateKey,
    256,
  ));

  const info = concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const prkAuth = await hkdfExtract(auth, ecdh);
  const ikm = await hkdfExpand(prkAuth, info, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdfExpand(prk, concat(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const padded = concat(utf8(klartext), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aes,
    padded,
  ));

  const rs = 4096;
  const kopf = new Uint8Array(16 + 4 + 1 + asPublic.length);
  kopf.set(salt, 0);
  kopf[16] = (rs >> 24) & 0xff;
  kopf[17] = (rs >> 16) & 0xff;
  kopf[18] = (rs >> 8) & 0xff;
  kopf[19] = rs & 0xff;
  kopf[20] = asPublic.length;
  kopf.set(asPublic, 21);
  return concat(kopf, chiffre);
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk, info, laenge) {
  const t = await hmacSha256(prk, concat(info, new Uint8Array([1])));
  return t.subarray(0, laenge);
}

async function hmacSha256(keyBytes, daten) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, daten));
}

function concat(...teile) {
  let n = 0;
  for (const t of teile) n += t.length;
  const out = new Uint8Array(n);
  let i = 0;
  for (const t of teile) {
    out.set(t, i);
    i += t.length;
  }
  return out;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

function jsonB64(objekt) {
  return bytesB64url(utf8(JSON.stringify(objekt)));
}

function bytesB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlBytes(text) {
  const pad = '='.repeat((4 - (String(text).length % 4)) % 4);
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
