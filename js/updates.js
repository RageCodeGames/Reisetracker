/**
 * Grüße und Fotos laden. Dateien fehlen oder sind kaputt: leere Liste.
 * Fotos: zuerst klein, groß erst beim Öffnen. Blob-URLs merken.
 */

import { bytesEntschluesseln, jsonEntschluesseln } from './crypto.js';

const fotoCache = new Map();

/** Entschlüsselte Grüße einer Reise, sonst []. */
export async function updatesLaden(reiseId, key) {
  if (!reiseId || !key) return [];
  try {
    const antwort = await fetch(
      new URL(`./daten/${encodeURIComponent(reiseId)}/updates.enc.json`, document.baseURI),
      { cache: 'no-store' },
    );
    if (!antwort.ok) return [];
    const paket = await antwort.json();
    const klar = await jsonEntschluesseln(paket, key);
    const liste = Array.isArray(klar?.updates) ? klar.updates : [];
    return liste.filter((eintrag) => eintrag && eintrag.id);
  } catch {
    return [];
  }
}

export function neuesterGruss(updates) {
  const liste = Array.isArray(updates) ? [...updates] : [];
  liste.sort((a, b) => String(b.zeit || '').localeCompare(String(a.zeit || '')));
  return liste[0] || null;
}

/** „vor 2 Std.“ / „vor 1 Tag“ relativ zu jetzt. */
export function vorRelativ(iso, jetzt = new Date()) {
  const zeit = new Date(iso);
  if (Number.isNaN(zeit.getTime())) return '';
  const minuten = Math.max(0, Math.round((jetzt.getTime() - zeit.getTime()) / 60000));
  if (minuten < 1) return 'gerade eben';
  if (minuten === 1) return 'vor 1 Min.';
  if (minuten < 60) return `vor ${minuten} Min.`;
  const stunden = Math.round(minuten / 60);
  if (stunden === 1) return 'vor 1 Std.';
  if (stunden < 24) return `vor ${stunden} Std.`;
  const tage = Math.round(stunden / 24);
  return tage === 1 ? 'vor 1 Tag' : `vor ${tage} Tagen`;
}

/**
 * Grüße nach Kalendertag in der Reise-Zeitzone.
 * Außerhalb von von/bis: vor / nach.
 */
export function updatesNachZeitraum(updates, eintrag, zone = 'Europe/Berlin') {
  const vor = [];
  const nach = [];
  const nachTag = new Map();
  for (const gruss of updates || []) {
    const zeit = new Date(gruss.zeit);
    if (Number.isNaN(zeit.getTime())) continue;
    const iso = tagIsoZone(zeit, zone);
    if (eintrag?.von && iso < eintrag.von) vor.push(gruss);
    else if (eintrag?.bis && iso > eintrag.bis) nach.push(gruss);
    else {
      if (!nachTag.has(iso)) nachTag.set(iso, []);
      nachTag.get(iso).push(gruss);
    }
  }
  const zeitSort = (a, b) => String(a.zeit).localeCompare(String(b.zeit));
  vor.sort(zeitSort);
  nach.sort(zeitSort);
  for (const liste of nachTag.values()) liste.sort(zeitSort);
  return { vor, nach, nachTag };
}

export function kleinPfad(foto) {
  return foto?.klein || foto?.datei || '';
}

export function grossPfad(foto) {
  return foto?.datei || foto?.klein || '';
}

export async function fotoUrl(reiseId, relPfad, key) {
  if (!reiseId || !relPfad || !key) return '';
  const schluessel = `${reiseId}/${relPfad}`;
  const bekannt = fotoCache.get(schluessel);
  if (bekannt?.url) return bekannt.url;
  if (bekannt?.warten) return bekannt.warten;
  const warten = (async () => {
    const antwort = await fetch(
      new URL(`./daten/${encodeURIComponent(reiseId)}/${relPfad}`, document.baseURI),
    );
    if (!antwort.ok) throw new Error('foto');
    const puffer = new Uint8Array(await antwort.arrayBuffer());
    const jpeg = await bytesEntschluesseln(puffer, key);
    const blob = new Blob([jpeg], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    fotoCache.set(schluessel, { url });
    return url;
  })();
  fotoCache.set(schluessel, { warten });
  try {
    return await warten;
  } catch (fehler) {
    fotoCache.delete(schluessel);
    throw fehler;
  }
}

export function fotoUrlsFreigeben() {
  for (const eintrag of fotoCache.values()) {
    if (eintrag.url) URL.revokeObjectURL(eintrag.url);
  }
  fotoCache.clear();
}

/** Bild erst laden, wenn es ins Blickfeld kommt. */
export function lazyBild(img, laden) {
  const beobachten = async (eintraege, observer) => {
    if (!eintraege.some((e) => e.isIntersecting)) return;
    observer.disconnect();
    try {
      const url = await laden();
      if (url && img.isConnected) img.src = url;
    } catch {
      if (img.isConnected) img.hidden = true;
    }
  };
  if (typeof IntersectionObserver !== 'function') {
    laden().then((url) => { img.src = url; }).catch(() => { img.hidden = true; });
    return;
  }
  const observer = new IntersectionObserver(beobachten, { rootMargin: '80px' });
  observer.observe(img);
}

function tagIsoZone(date, zone) {
  const teile = {};
  for (const teil of new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    if (teil.type !== 'literal') teile[teil.type] = teil.value;
  }
  return `${teile.year}-${teile.month}-${teile.day}`;
}
