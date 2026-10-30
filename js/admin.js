/**
 * Upload-Seite: Grüße und Fotos verschlüsselt in einem GitHub-Commit.
 * Token und Passwort werden nicht geloggt und nicht angezeigt.
 */

import {
  base64AusBytes,
  bytesAusBase64,
  bytesVerschluesseln,
  jsonEntschluesseln,
  jsonVerschluesseln,
  schluesselAbleiten,
  schluesselAlsRohdaten,
  schluesselAusRohdaten,
} from './crypto.js';
import { aktiveReise } from './trip.js';

const SPEICHER_SCHLUESSEL = 'reisetracker.schluessel';
const SPEICHER_NAME = 'reisetracker.admin.name';
const SPEICHER_BENUTZER = 'reisetracker.admin.benutzer';
const SPEICHER_REPO = 'reisetracker.admin.repo';
const SPEICHER_TOKEN = 'reisetracker.admin.token';
const DB_NAME = 'reisetracker.admin';
const STORE = 'warteschlange';
const MAX_FOTOS = 10;
const GROSS_PX = 1600;
const KLEIN_PX = 400;
const GROSS_Q = 0.8;
const KLEIN_Q = 0.7;

const passwortSchirm = document.querySelector('#passwort-schirm');
const einrichtSchirm = document.querySelector('#einricht-schirm');
const sendeSchirm = document.querySelector('#sende-schirm');
const passwortFormular = document.querySelector('#passwort-formular');
const passwortEingabe = document.querySelector('#passwort');
const passwortFehler = document.querySelector('#passwort-fehler');
const einrichtFormular = document.querySelector('#einricht-formular');
const einrichtFehler = document.querySelector('#einricht-fehler');
const grussFormular = document.querySelector('#gruss-formular');
const reiseWahl = document.querySelector('#reise-wahl');
const grussText = document.querySelector('#gruss-text');
const grussFotos = document.querySelector('#gruss-fotos');
const fotoVorschau = document.querySelector('#foto-vorschau');
const standortKasten = document.querySelector('#gruss-standort');
const sendeFehler = document.querySelector('#sende-fehler');
const sendeOk = document.querySelector('#sende-ok');
const sendeFortschritt = document.querySelector('#sende-fortschritt');
const sendeKnopf = document.querySelector('#sende-knopf');
const warteHinweis = document.querySelector('#warte-hinweis');
const jetztSenden = document.querySelector('#jetzt-senden');
const updateListe = document.querySelector('#update-liste');
const updateListeLeer = document.querySelector('#update-liste-leer');

let konfig = null;
let schluessel = null;
let index = null;
let gewaehlteId = null;
let vorschauUrls = [];
let sendeLaeuft = false;

passwortFormular.addEventListener('submit', passwortAbsenden);
einrichtFormular.addEventListener('submit', einrichtungSpeichern);
grussFormular.addEventListener('submit', grussAbsenden);
grussFotos.addEventListener('change', vorschauAktualisieren);
reiseWahl.addEventListener('change', () => {
  gewaehlteId = reiseWahl.value;
  listeAktualisieren().catch(() => {});
});
jetztSenden.addEventListener('click', () => warteschlangeSenden(true));
document.querySelector('#abmelden').addEventListener('click', abmelden);
document.querySelector('#einricht-abmelden').addEventListener('click', abmelden);
window.addEventListener('online', () => {
  if (!sendeSchirm.hidden) warteschlangeSenden(false);
});

start();

async function start() {
  try {
    konfig = await jsonDatei('./config.json');
  } catch {
    zeige(passwortFehler, 'Die Einstellungen fehlen. Die Seite ist unvollständig.');
    return;
  }
  if (!konfig.salt || !konfig.iterationen) {
    zeige(passwortFehler, 'Die Einstellungen sind unvollständig.');
    return;
  }

  const gespeichert = speicherLesen(SPEICHER_SCHLUESSEL);
  if (gespeichert) {
    try {
      const key = await schluesselAusRohdaten(gespeichert);
      await indexLaden(key);
      nachPasswort();
      return;
    } catch (problem) {
      if (istPasswortFalsch(problem)) speicherLoeschen(SPEICHER_SCHLUESSEL);
      else {
        zeige(passwortFehler, meldungFuer(problem));
        return;
      }
    }
  }
  schirm(passwortSchirm);
  passwortEingabe.focus();
}

async function passwortAbsenden(ereignis) {
  ereignis.preventDefault();
  verstecke(passwortFehler);
  const knopf = passwortFormular.querySelector('button');
  knopf.disabled = true;
  const alter = knopf.textContent;
  knopf.textContent = 'Einen Moment …';
  try {
    const key = await schluesselAbleiten(
      passwortEingabe.value,
      bytesAusBase64(konfig.salt),
      konfig.iterationen,
    );
    await indexLaden(key);
    passwortEingabe.value = '';
    speicherSchreiben(SPEICHER_SCHLUESSEL, await schluesselAlsRohdaten(key));
    nachPasswort();
  } catch (problem) {
    zeige(passwortFehler, meldungFuer(problem));
  } finally {
    knopf.disabled = false;
    knopf.textContent = alter;
  }
}

function nachPasswort() {
  if (!einrichtungVollstaendig()) {
    schirm(einrichtSchirm);
    document.querySelector('#einricht-name').value = speicherLesen(SPEICHER_NAME) || '';
    document.querySelector('#einricht-benutzer').value = speicherLesen(SPEICHER_BENUTZER) || '';
    document.querySelector('#einricht-repo').value = speicherLesen(SPEICHER_REPO) || '';
    document.querySelector('#einricht-token').value = '';
    document.querySelector('#einricht-name').focus();
    return;
  }
  sendeSchirmZeigen();
}

function einrichtungSpeichern(ereignis) {
  ereignis.preventDefault();
  verstecke(einrichtFehler);
  const name = document.querySelector('#einricht-name').value.trim();
  const benutzer = document.querySelector('#einricht-benutzer').value.trim();
  const repo = document.querySelector('#einricht-repo').value.trim();
  const token = document.querySelector('#einricht-token').value.trim();
  if (!name || !benutzer || !repo || !token) {
    zeige(einrichtFehler, 'Bitte alle Felder ausfüllen.');
    return;
  }
  const ok = speicherSchreiben(SPEICHER_NAME, name)
    && speicherSchreiben(SPEICHER_BENUTZER, benutzer)
    && speicherSchreiben(SPEICHER_REPO, repo)
    && speicherSchreiben(SPEICHER_TOKEN, token);
  document.querySelector('#einricht-token').value = '';
  if (!ok) {
    zeige(einrichtFehler, 'Auf diesem Gerät kann ich mir die Angaben nicht merken.');
    return;
  }
  sendeSchirmZeigen();
}

function sendeSchirmZeigen() {
  schirm(sendeSchirm);
  reisenFuellen();
  warteschlangeAnzeigen();
  listeAktualisieren().catch(() => {});
  warteschlangeSenden(false);
}

function reisenFuellen() {
  const reisen = Array.isArray(index?.reisen) ? [...index.reisen] : [];
  reisen.sort((a, b) => String(a.von).localeCompare(String(b.von)));
  const aktiv = aktiveReise(index, new Date());
  gewaehlteId = aktiv?.id || reisen[0]?.id || '';
  reiseWahl.replaceChildren();
  for (const reise of reisen) {
    const option = document.createElement('option');
    option.value = reise.id;
    option.textContent = reise.titel || reise.id;
    if (reise.id === gewaehlteId) option.selected = true;
    reiseWahl.append(option);
  }
}

function vorschauAktualisieren() {
  for (const url of vorschauUrls) URL.revokeObjectURL(url);
  vorschauUrls = [];
  fotoVorschau.replaceChildren();
  const dateien = gewaehlteDateien();
  if ((grussFotos.files || []).length > MAX_FOTOS) {
    zeige(sendeFehler, 'Höchstens 10 Fotos. Die ersten 10 werden genommen.');
  }
  if (dateien.length === 0) {
    fotoVorschau.hidden = true;
    return;
  }
  fotoVorschau.hidden = false;
  for (const datei of dateien) {
    const url = URL.createObjectURL(datei);
    vorschauUrls.push(url);
    const img = document.createElement('img');
    img.alt = datei.name || 'Foto';
    img.src = url;
    fotoVorschau.append(img);
  }
}

function gewaehlteDateien() {
  return [...(grussFotos.files || [])].slice(0, MAX_FOTOS);
}

async function grussAbsenden(ereignis) {
  ereignis.preventDefault();
  if (sendeLaeuft) return;
  verstecke(sendeFehler);
  verstecke(sendeOk);
  const text = grussText.value.trim();
  const dateien = gewaehlteDateien();
  if (!text && dateien.length === 0) {
    zeige(sendeFehler, 'Bitte einen Gruß schreiben oder Fotos wählen.');
    return;
  }
  if (!gewaehlteId) {
    zeige(sendeFehler, 'Keine Reise gefunden.');
    return;
  }
  sendeLaeuft = true;
  sendeKnopf.disabled = true;
  try {
    fortschritt('Fotos werden vorbereitet …');
    const paket = await grussBauen(text, dateien);
    await paketSenden(paket);
    formularLeeren();
    zeige(sendeOk, 'Der Gruß ist unterwegs.');
    await listeAktualisieren();
  } catch (problem) {
    if (istOffline(problem)) {
      try {
        await warteschlangeLegen(problem.paket || await grussBauen(text, dateien));
        formularLeeren();
        zeige(sendeOk, 'Kein Internet. Der Gruß wartet auf diesem Gerät.');
      } catch {
        zeige(sendeFehler, 'Ohne Internet und Speichern hat es nicht geklappt.');
      }
    } else {
      zeige(sendeFehler, meldungFuer(problem));
    }
  } finally {
    sendeLaeuft = false;
    sendeKnopf.disabled = false;
    verstecke(sendeFortschritt);
    warteschlangeAnzeigen();
  }
}

async function grussBauen(text, dateien) {
  const name = speicherLesen(SPEICHER_NAME) || '';
  const eintrag = {
    id: zufallsId(),
    zeit: new Date().toISOString(),
    von: name,
    text,
    fotos: [],
  };
  if (standortKasten.checked) {
    const lage = await standortHolen();
    if (lage) {
      eintrag.lat = lage.lat;
      eintrag.lon = lage.lon;
    }
  }
  const blobs = [];
  for (let i = 0; i < dateien.length; i += 1) {
    fortschritt(`Foto ${i + 1} von ${dateien.length} …`);
    const gross = await bildVerkleinern(dateien[i], GROSS_PX, GROSS_Q);
    const klein = await bildVerkleinern(dateien[i], KLEIN_PX, KLEIN_Q);
    const fotoId = zufallsId();
    const pfadGross = `fotos/${fotoId}.bin`;
    const pfadKlein = `fotos/${fotoId}-k.bin`;
    blobs.push({
      pfad: `daten/${gewaehlteId}/${pfadGross}`,
      bytes: await bytesVerschluesseln(gross.bytes, schluessel),
    });
    blobs.push({
      pfad: `daten/${gewaehlteId}/${pfadKlein}`,
      bytes: await bytesVerschluesseln(klein.bytes, schluessel),
    });
    eintrag.fotos.push({
      datei: pfadGross,
      klein: pfadKlein,
      breite: gross.breite,
      hoehe: gross.hoehe,
    });
  }
  return { reiseId: gewaehlteId, eintrag, blobs };
}

async function paketSenden(paket) {
  if (!navigator.onLine) {
    const problem = new Error('offline');
    problem.paket = paket;
    throw problem;
  }
  let letzterFehler = null;
  for (let versuch = 0; versuch < 4; versuch += 1) {
    try {
      fortschritt('Gruß wird gespeichert …');
      await githubCommit(paket, false);
      return;
    } catch (problem) {
      if (istOffline(problem)) {
        problem.paket = paket;
        throw problem;
      }
      if (istKonflikt(problem) && versuch < 3) {
        letzterFehler = problem;
        continue;
      }
      throw problem;
    }
  }
  throw letzterFehler || new Error('github');
}

async function githubCommit(paket, loeschen) {
  const { owner, repo, branch, head, treeSha } = await repoKopf();
  const liste = await updatesLaden(owner, repo, branch, paket.reiseId);
  const updates = Array.isArray(liste.updates) ? [...liste.updates] : [];
  const baum = [];

  if (loeschen) {
    const indexEintrag = updates.findIndex((u) => u.id === paket.eintrag.id);
    if (indexEintrag < 0) return;
    const alt = updates[indexEintrag];
    updates.splice(indexEintrag, 1);
    for (const foto of alt.fotos || []) {
      if (foto.datei) baum.push(dateiLoeschen(`daten/${paket.reiseId}/${foto.datei}`));
      if (foto.klein) baum.push(dateiLoeschen(`daten/${paket.reiseId}/${foto.klein}`));
    }
  } else if (!updates.some((u) => u.id === paket.eintrag.id)) {
    updates.push(paket.eintrag);
    const fotoZahl = paket.eintrag.fotos.length;
    let fotoNr = 0;
    for (const blob of paket.blobs) {
      if (blob.pfad.endsWith('-k.bin')) {
        fotoNr += 1;
        fortschritt(`Foto ${fotoNr} von ${Math.max(1, fotoZahl)} …`);
      }
      const sha = await blobAnlegen(owner, repo, blob.bytes);
      baum.push({
        path: blob.pfad,
        mode: '100644',
        type: 'blob',
        sha,
      });
    }
  }

  const paketJson = await jsonVerschluesseln({ updates }, schluessel);
  const jsonBytes = new TextEncoder().encode(`${JSON.stringify(paketJson)}\n`);
  const jsonSha = await blobAnlegen(owner, repo, jsonBytes);
  baum.push({
    path: `daten/${paket.reiseId}/updates.enc.json`,
    mode: '100644',
    type: 'blob',
    sha: jsonSha,
  });

  const tree = await github(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: treeSha, tree: baum },
  });
  const commit = await github(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: { message: 'Update', tree: tree.sha, parents: [head] },
  });
  await github(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });
}

function dateiLoeschen(pfad) {
  return { path: pfad, mode: '100644', type: 'blob', sha: null };
}

async function repoKopf() {
  const owner = speicherLesen(SPEICHER_BENUTZER);
  const repo = speicherLesen(SPEICHER_REPO);
  const info = await github(`/repos/${owner}/${repo}`);
  const branch = info.default_branch || 'main';
  const ref = await github(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const head = ref.object?.sha;
  const commit = await github(`/repos/${owner}/${repo}/git/commits/${head}`);
  return { owner, repo, branch, head, treeSha: commit.tree.sha };
}

async function blobAnlegen(owner, repo, bytes) {
  const data = await github(`/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: {
      content: base64AusBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
      encoding: 'base64',
    },
  });
  return data.sha;
}

async function updatesLaden(owner, repo, branch, reiseId) {
  try {
    const datei = await github(
      `/repos/${owner}/${repo}/contents/daten/${encodeURIComponent(reiseId)}/updates.enc.json?ref=${encodeURIComponent(branch)}`,
    );
    if (!datei?.content) return { updates: [] };
    const roh = JSON.parse(atob(String(datei.content).replace(/\s/g, '')));
    const klar = await jsonEntschluesseln(roh, schluessel);
    if (!klar || !Array.isArray(klar.updates)) return { updates: [] };
    return klar;
  } catch (problem) {
    if (problem?.code === 404) return { updates: [] };
    throw problem;
  }
}

async function listeAktualisieren() {
  if (!gewaehlteId || !einrichtungVollstaendig()) return;
  try {
    const { owner, repo, branch } = await repoKopf();
    const liste = await updatesLaden(owner, repo, branch, gewaehlteId);
    listeZeichnen(liste.updates);
  } catch (problem) {
    if (!istOffline(problem)) {
      listeZeichnen([]);
    }
  }
}

function listeZeichnen(updates) {
  updateListe.replaceChildren();
  const sortiert = [...(updates || [])].sort((a, b) => String(b.zeit).localeCompare(String(a.zeit)));
  updateListeLeer.hidden = sortiert.length > 0;
  for (const eintrag of sortiert) {
    const li = document.createElement('li');
    li.className = 'update-karte';
    const meta = document.createElement('p');
    meta.className = 'update-meta';
    meta.textContent = `${eintrag.von || 'Unbekannt'} · ${zeitText(eintrag.zeit)}`;
    const text = document.createElement('p');
    text.textContent = eintrag.text || (eintrag.fotos?.length ? `${eintrag.fotos.length} Foto(s)` : 'Ohne Text');
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.textContent = 'Löschen';
    knopf.addEventListener('click', () => updateLoeschen(eintrag));
    li.append(meta, text, knopf);
    updateListe.append(li);
  }
}

async function updateLoeschen(eintrag) {
  if (sendeLaeuft) return;
  if (!window.confirm('Diesen Gruß wirklich löschen?')) return;
  sendeLaeuft = true;
  try {
    fortschritt('Wird gelöscht …');
    verstecke(sendeFehler);
    await githubCommit({ reiseId: gewaehlteId, eintrag, blobs: [] }, true);
    zeige(sendeOk, 'Der Gruß ist gelöscht.');
    await listeAktualisieren();
  } catch (problem) {
    zeige(sendeFehler, istOffline(problem)
      ? 'Zum Löschen braucht es Internet.'
      : meldungFuer(problem));
  } finally {
    sendeLaeuft = false;
    verstecke(sendeFortschritt);
  }
}

async function warteschlangeLegen(paket) {
  const db = await dbOeffnen();
  await new Promise((ok, fehl) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => ok();
    tx.onerror = () => fehl(tx.error);
    tx.objectStore(STORE).put({
      id: paket.eintrag.id,
      reiseId: paket.reiseId,
      eintrag: paket.eintrag,
      blobs: paket.blobs.map((b) => ({ pfad: b.pfad, bytes: b.bytes.buffer })),
    });
  });
  warteschlangeAnzeigen();
}

async function warteschlangeSenden(manuell) {
  const liste = await warteschlangeLesen();
  if (liste.length === 0) {
    warteschlangeAnzeigen();
    return;
  }
  if (!navigator.onLine) {
    if (manuell) zeige(sendeFehler, 'Noch kein Internet.');
    warteschlangeAnzeigen();
    return;
  }
  if (sendeLaeuft && !manuell) return;
  sendeLaeuft = true;
  jetztSenden.disabled = true;
  try {
    for (const item of liste) {
      const paket = {
        reiseId: item.reiseId,
        eintrag: item.eintrag,
        blobs: (item.blobs || []).map((b) => ({
          pfad: b.pfad,
          bytes: new Uint8Array(b.bytes),
        })),
      };
      await paketSenden(paket);
      await warteschlangeEntfernen(item.id);
    }
    if (liste.length > 0) {
      zeige(sendeOk, liste.length === 1 ? 'Der gespeicherte Gruß ist weg.' : 'Die gespeicherten Grüße sind weg.');
      await listeAktualisieren();
    }
  } catch (problem) {
    if (manuell && !istOffline(problem)) zeige(sendeFehler, meldungFuer(problem));
  } finally {
    sendeLaeuft = false;
    jetztSenden.disabled = false;
    verstecke(sendeFortschritt);
    warteschlangeAnzeigen();
  }
}

async function warteschlangeLesen() {
  try {
    const db = await dbOeffnen();
    return await new Promise((ok, fehl) => {
      const tx = db.transaction(STORE, 'readonly');
      const anfrage = tx.objectStore(STORE).getAll();
      anfrage.onsuccess = () => ok(anfrage.result || []);
      anfrage.onerror = () => fehl(anfrage.error);
    });
  } catch {
    return [];
  }
}

async function warteschlangeEntfernen(id) {
  const db = await dbOeffnen();
  await new Promise((ok, fehl) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => ok();
    tx.onerror = () => fehl(tx.error);
    tx.objectStore(STORE).delete(id);
  });
}

async function warteschlangeLeeren() {
  try {
    const db = await dbOeffnen();
    await new Promise((ok, fehl) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => ok();
      tx.onerror = () => fehl(tx.error);
      tx.objectStore(STORE).clear();
    });
  } catch {
    // Speicher schon weg.
  }
}

function warteschlangeAnzeigen() {
  warteschlangeLesen().then((liste) => {
    const n = liste.length;
    if (n === 0) {
      warteHinweis.hidden = true;
      jetztSenden.hidden = true;
      return;
    }
    warteHinweis.hidden = false;
    warteHinweis.textContent = n === 1
      ? '1 Gruß wartet auf Internet'
      : `${n} Grüße warten auf Internet`;
    jetztSenden.hidden = false;
  });
}

function dbOeffnen() {
  return new Promise((ok, fehl) => {
    const anfrage = indexedDB.open(DB_NAME, 1);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    anfrage.onsuccess = () => ok(anfrage.result);
    anfrage.onerror = () => fehl(anfrage.error);
  });
}

async function bildVerkleinern(datei, maxSeite, qualitaet) {
  const quelle = await bitmapAusDatei(datei);
  const origW = quelle.width;
  const origH = quelle.height;
  const skala = Math.min(1, maxSeite / Math.max(origW, origH));
  const breite = Math.max(1, Math.round(origW * skala));
  const hoehe = Math.max(1, Math.round(origH * skala));
  const canvas = document.createElement('canvas');
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(quelle, 0, 0, breite, hoehe);
  if (quelle.close) quelle.close();
  const blob = await new Promise((ok, fehl) => {
    canvas.toBlob((ergebnis) => {
      if (ergebnis) ok(ergebnis);
      else fehl(new Error('bild'));
    }, 'image/jpeg', qualitaet);
  });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), breite, hoehe };
}

async function bitmapAusDatei(datei) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(datei);
    } catch {
      // Fallback über Image, z. B. bei ungewöhnlichen Formaten.
    }
  }
  return new Promise((ok, fehl) => {
    const img = new Image();
    const url = URL.createObjectURL(datei);
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      fehl(new Error('bild'));
    };
    img.src = url;
  });
}

function standortHolen() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((ok) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => ok({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => ok(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  });
}

async function indexLaden(key) {
  const paket = await jsonDatei('./daten/index.enc.json');
  try {
    index = await jsonEntschluesseln(paket, key);
  } catch (problem) {
    if (istPasswortFalsch(problem)) throw problem;
    throw new Error('daten');
  }
  schluessel = key;
}

async function github(pfad, optionen = {}) {
  const token = speicherLesen(SPEICHER_TOKEN);
  const koerper = optionen.body != null ? JSON.stringify(optionen.body) : undefined;
  let antwort;
  try {
    antwort = await fetch(`https://api.github.com${pfad}`, {
      method: optionen.method || 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(koerper ? { 'Content-Type': 'application/json' } : {}),
      },
      body: koerper,
    });
  } catch {
    throw new Error('offline');
  }
  if (!antwort.ok) {
    const problem = new Error('github');
    problem.code = antwort.status;
    throw problem;
  }
  if (antwort.status === 204) return null;
  return antwort.json();
}

function formularLeeren() {
  grussText.value = '';
  grussFotos.value = '';
  vorschauAktualisieren();
}

function fortschritt(text) {
  zeige(sendeFortschritt, text);
}

function abmelden() {
  speicherLoeschen(SPEICHER_SCHLUESSEL);
  speicherLoeschen(SPEICHER_NAME);
  speicherLoeschen(SPEICHER_BENUTZER);
  speicherLoeschen(SPEICHER_REPO);
  speicherLoeschen(SPEICHER_TOKEN);
  warteschlangeLeeren();
  schluessel = null;
  index = null;
  gewaehlteId = null;
  passwortEingabe.value = '';
  document.querySelector('#einricht-token').value = '';
  schirm(passwortSchirm);
  passwortEingabe.focus();
}

function einrichtungVollstaendig() {
  return Boolean(
    speicherLesen(SPEICHER_NAME)
    && speicherLesen(SPEICHER_BENUTZER)
    && speicherLesen(SPEICHER_REPO)
    && speicherLesen(SPEICHER_TOKEN),
  );
}

function schirm(aktiv) {
  passwortSchirm.hidden = aktiv !== passwortSchirm;
  einrichtSchirm.hidden = aktiv !== einrichtSchirm;
  sendeSchirm.hidden = aktiv !== sendeSchirm;
}

function zeige(el, text) {
  el.textContent = text;
  el.hidden = false;
}

function verstecke(el) {
  el.hidden = true;
  el.textContent = '';
}

function zufallsId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function zeitText(iso) {
  const zeit = new Date(iso);
  if (Number.isNaN(zeit.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(zeit);
}

function seitenPfad(pfad) {
  return new URL(pfad, document.baseURI).href;
}

async function jsonDatei(pfad) {
  const antwort = await fetch(seitenPfad(pfad), { cache: 'no-store' });
  if (!antwort.ok) {
    const problem = new Error('datei');
    problem.code = antwort.status;
    throw problem;
  }
  return antwort.json();
}

function speicherLesen(name) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

function speicherSchreiben(name, wert) {
  try {
    localStorage.setItem(name, wert);
    return true;
  } catch {
    return false;
  }
}

function speicherLoeschen(name) {
  try {
    localStorage.removeItem(name);
  } catch {
    // Privater Modus.
  }
}

function istPasswortFalsch(problem) {
  return problem?.name === 'OperationError';
}

function istOffline(problem) {
  return problem?.message === 'offline' || problem?.name === 'TypeError';
}

function istKonflikt(problem) {
  return problem?.code === 409 || problem?.code === 422;
}

function meldungFuer(problem) {
  if (istPasswortFalsch(problem)) return 'Das Passwort stimmt leider nicht.';
  if (problem?.message === 'bild') return 'Ein Foto ließ sich nicht lesen.';
  if (problem?.code === 401 || problem?.code === 403) {
    return 'GitHub hat abgelehnt. Bitte Token und Rechte prüfen (Inhalt schreiben).';
  }
  if (problem?.code === 404) return 'Das Repository wurde nicht gefunden.';
  if (problem?.code === 409 || problem?.code === 422) {
    return 'Jemand hat gleichzeitig etwas gesendet. Bitte noch einmal versuchen.';
  }
  if (istOffline(problem)) return 'Kein Internet.';
  if (problem?.code === 404 || problem?.message === 'daten') {
    return 'Die verschlüsselten Reisedaten fehlen noch.';
  }
  return 'Das hat leider nicht geklappt. Bitte später noch einmal versuchen.';
}
