/**
 * Erzeugt ein VAPID-Schlüsselpaar (P-256) für Web Push.
 * Nur Node-Bordmittel. Schreibt nichts auf die Platte.
 *
 * Aufruf: node tools/vapid.mjs
 */

import { webcrypto } from 'node:crypto';

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const rawPub = new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey));
const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);

const publicB64 = base64url(rawPub);
const privateB64 = jwk.d;

console.log('VAPID-Schlüsselpaar (einmal erzeugen, privat nie ins Repo):\n');
console.log('Public Key (base64url):');
console.log(publicB64);
console.log('\nPrivate Key (base64url):');
console.log(privateB64);
console.log(`
Wohin welcher Wert gehört:

  Public Key
    → config.json Feld "vapidPublicKey" (ist öffentlich, darf ins Repo)
    → Cloudflare Worker Secret VAPID_PUBLIC_KEY (derselbe Wert)

  Private Key
    → NUR Cloudflare Worker Secret VAPID_PRIVATE_KEY
    → niemals in config.json, niemals ins Git-Repo, niemals teilen

Danach in Cloudflare noch setzen:
  VAPID_SUBJECT     z. B. mailto:deine@adresse.de
  NOTIFY_SECRET     langes Zufallswort, nur du und die Upload-Seite
  FAMILY_PUSH_TOKEN aus der Upload-Seite kopieren (nach Passwort)
`);

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
