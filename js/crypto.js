/**
 * Schlüssel ableiten und JSON entschlüsseln.
 * Muss exakt zu tools/verschluesseln.mjs passen:
 * PBKDF2-SHA256,  AES-GCM 256, Format { "v": 1, "iv", "daten" }.
 * Das Familien-Passwort wird hier nie gespeichert.
 */

export const IV_LAENGE = 12;

/** Base64 (Standard, mit Padding) in Bytes. */
export function bytesAusBase64(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Bytes in Standard-Base64. */
export function base64AusBytes(bytes) {
  const teile = [];
  const schritt = 0x8000;
  for (let i = 0; i < bytes.length; i += schritt) {
    teile.push(String.fromCharCode(...bytes.subarray(i, i + schritt)));
  }
  return btoa(teile.join(''));
}

/**
 * Leitet den AES-Schlüssel aus dem Passwort ab.
 * salt ist ein Uint8Array, iterationen kommt aus config.json.
 */
export async function schluesselAbleiten(passwort, salt, iterationen) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passwort),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: iterationen,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** Rohbytes des Schlüssels als Base64, zum Merken im Browser. */
export async function schluesselAlsRohdaten(key) {
  const roh = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return base64AusBytes(roh);
}

/** Holt den gemerkten Schlüssel zurück. */
export async function schluesselAusRohdaten(base64) {
  return crypto.subtle.importKey(
    'raw',
    bytesAusBase64(base64),
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Verschlüsselt einen Text oder ein Objekt.
 * Wird vom Node-Skript benutzt, damit Browser und Skript dasselbe Format schreiben.
 */
export async function jsonVerschluesseln(wert, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LAENGE));
  const text = typeof wert === 'string' ? wert : JSON.stringify(wert);
  const chiffre = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  return {
    v: 1,
    iv: base64AusBytes(iv),
    daten: base64AusBytes(new Uint8Array(chiffre)),
  };
}

/**
 * Verschlüsselt Rohbytes. Datei = 12 Byte IV + AES-GCM-Chiffrat.
 * Für Fotos: kein JSON, keine EXIF, kein Klartext im Repo.
 */
export async function bytesVerschluesseln(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LAENGE));
  const chiffre = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bytes,
  ));
  const paket = new Uint8Array(IV_LAENGE + chiffre.length);
  paket.set(iv, 0);
  paket.set(chiffre, IV_LAENGE);
  return paket;
}

/** Entschlüsselt 12 Byte IV + Chiffrat zurück zu den Rohbytes. */
export async function bytesEntschluesseln(paket, key) {
  if (!(paket instanceof Uint8Array) || paket.length <= IV_LAENGE) {
    throw new Error('Unbekanntes Datenformat');
  }
  const klar = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: paket.subarray(0, IV_LAENGE) },
    key,
    paket.subarray(IV_LAENGE),
  );
  return new Uint8Array(klar);
}

/** Entschlüsselt ein Paket { v, iv, daten } zu einem Objekt. Wirft bei falschem Schlüssel. */
export async function jsonEntschluesseln(paket, key) {
  if (!paket || paket.v !== 1 || typeof paket.iv !== 'string' || typeof paket.daten !== 'string') {
    throw new Error('Unbekanntes Datenformat');
  }
  const klar = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesAusBase64(paket.iv) },
    key,
    bytesAusBase64(paket.daten),
  );
  return JSON.parse(new TextDecoder().decode(klar));
}
