/**
 * Passwort, Entschlüsseln, Statuskarte, Karte und Tagesübersicht.
 * Der Schlüssel (nie das Passwort) bleibt auf diesem Gerät, bis jemand abmeldet.
 * Die Ansicht wird jede Minute neu gerechnet, auch für ?zeit=.
 */

import {
  bytesAusBase64,
  jsonEntschluesseln,
  schluesselAbleiten,
  schluesselAlsRohdaten,
  schluesselAusRohdaten,
} from './crypto.js';
import {
  aktiveReise,
  getStatus,
  ortPopup,
  statusKarte,
  tagesUebersicht,
  uhrzeitLang,
  zeitAusAdresse,
} from './trip.js';
import {
  fotoUrl,
  fotoUrlsFreigeben,
  grossPfad,
  kleinPfad,
  lazyBild,
  neuesterGruss,
  updatesLaden,
  updatesNachZeitraum,
  vorRelativ,
} from './updates.js';

const SPEICHER = 'reisetracker.schluessel';
const SPEICHER_GESEHEN = 'reisetracker.gesehen';
const UPDATES_INTERVALL_MS = 5 * 60 * 1000;

const passwortSchirm = document.querySelector('#passwort-schirm');
const statusSchirm = document.querySelector('#status-schirm');
const formular = document.querySelector('#passwort-formular');
const eingabe = document.querySelector('#passwort');
const fehler = document.querySelector('#passwort-fehler');
const knopf = formular.querySelector('button');
const testzeit = document.querySelector('#testzeit');
const titel = document.querySelector('#reise-titel');
const untertitel = document.querySelector('#reise-untertitel');
const statusZeile = document.querySelector('#status-zeile');
const statusInfo = document.querySelector('#status-info');
const reiseBalken = document.querySelector('#reise-balken');
const reiseFuellung = document.querySelector('#reise-balken-fuellung');
const reiseText = document.querySelector('#reise-balken-text');
const karteRahmen = document.querySelector('#karte');
const karteFehler = document.querySelector('#karte-fehler');
const ganzeReiseKnopf = document.querySelector('#ganze-reise');
const woKnopf = document.querySelector('#wo-sind-wir');
const vorReise = document.querySelector('#vor-reise');
const tageListe = document.querySelector('#tage');
const nachReise = document.querySelector('#nach-reise');
const reiseLinks = document.querySelector('#reise-links');
const andereReisen = document.querySelector('#andere-reisen');
const reiseListe = document.querySelector('#reise-liste');
const ortDialog = document.querySelector('#ort-popup');
const ortName = document.querySelector('#ort-popup-name');
const ortLand = document.querySelector('#ort-popup-land');
const ortZeiten = document.querySelector('#ort-popup-zeiten');
const ortInfo = document.querySelector('#ort-popup-info');
const merkenHinweis = document.querySelector('#merken-hinweis');
const abmeldenKnopf = document.querySelector('#abmelden');
const vollbild = document.querySelector('#gruss-vollbild');
const vollbildFoto = document.querySelector('#gruss-vollbild-foto');
const vollbildOhneFoto = document.querySelector('#gruss-vollbild-ohne-foto');
const vollbildText = document.querySelector('#gruss-vollbild-text');
const vollbildZeit = document.querySelector('#gruss-vollbild-zeit');
const vollbildSchliessen = document.querySelector('#gruss-vollbild-schliessen');

let konfig = null;
let schluessel = null;
let index = null;
let zustand = null;
let gewaehlteId = null;
let timer = null;
let karte = null;
let karteLaeuft = false;
let tageGescrolltFuer = null;
let serviceWorkerNeu = false;
let updates = [];
let neuIds = new Set();
let gesehenBeimStart = new Set();
let updatesTimer = null;
let vollbildSlides = [];
let vollbildIndex = 0;
let wischX = null;

ganzeReiseKnopf.addEventListener('click', () => karte?.ganzeReise());
woKnopf.addEventListener('click', () => karte?.woSindWir());

formular.addEventListener('submit', async (ereignis) => {
  ereignis.preventDefault();
  fehler.hidden = true;
  const passwort = eingabe.value;
  knopf.disabled = true;
  const alterText = knopf.textContent;
  knopf.textContent = 'Einen Moment …';
  try {
    const key = await schluesselAbleiten(passwort, bytesAusBase64(konfig.salt), konfig.iterationen);
    await indexUndReiseLaden(key);
    eingabe.value = '';
    const gemerkt = schluesselMerken(await schluesselAlsRohdaten(key));
    merkenHinweis.hidden = gemerkt;
    zeigeStatus();
  } catch (problem) {
    fehler.textContent = meldungFuer(problem);
    fehler.hidden = false;
  } finally {
    knopf.disabled = false;
    knopf.textContent = alterText;
  }
});

abmeldenKnopf.addEventListener('click', abmelden);
vollbildSchliessen.addEventListener('click', vollbildSchliessenJetzt);
const vollbildFotoWrap = document.querySelector('.gruss-vollbild-foto-wrap');
vollbildFotoWrap.addEventListener('pointerdown', (ereignis) => {
  if (ereignis.pointerType === 'mouse' && ereignis.button !== 0) return;
  wischX = ereignis.clientX;
});
vollbildFotoWrap.addEventListener('pointerup', (ereignis) => {
  if (wischX == null) return;
  const delta = ereignis.clientX - wischX;
  wischX = null;
  if (delta > 60) vollbildSchritt(-1);
  else if (delta < -60) vollbildSchritt(1);
});
vollbildFotoWrap.addEventListener('pointercancel', () => { wischX = null; });
window.addEventListener('pagehide', gesehenSchreiben);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') gesehenSchreiben();
});

reiseListe.addEventListener('click', async (ereignis) => {
  const knopfReise = ereignis.target.closest('button[data-id]');
  if (!knopfReise || !schluessel) return;
  const id = knopfReise.dataset.id;
  if (!id || id === gewaehlteId) {
    andereReisen.open = false;
    return;
  }
  try {
    await tripLaden(schluessel, id);
    tageGescrolltFuer = null;
    andereReisen.open = false;
    zeichne();
  } catch (problem) {
    fehler.textContent = meldungFuer(problem);
    fehler.hidden = false;
    zeigePasswort();
  }
});

start();
serviceWorkerAnmelden();

async function start() {
  try {
    konfig = await jsonDatei('./config.json');
  } catch {
    zeigeFehler('Die Einstellungen fehlen. Die Seite ist unvollständig.');
    return;
  }
  if (!konfig.salt || !konfig.iterationen) {
    zeigeFehler('Die Einstellungen sind unvollständig.');
    return;
  }

  const gespeichert = schluesselLesen();
  if (gespeichert) {
    try {
      const key = await schluesselAusRohdaten(gespeichert);
      await indexUndReiseLaden(key);
      merkenHinweis.hidden = true;
      zeigeStatus();
      return;
    } catch (problem) {
      // Alter Schlüssel passt nicht mehr: still vergessen und neu fragen.
      if (istPasswortFalsch(problem)) schluesselVergessen();
      else {
        zeigeFehler(meldungFuer(problem));
        zeigePasswort();
        eingabe.focus();
        return;
      }
    }
  }
  zeigePasswort();
  eingabe.focus();
}

async function indexUndReiseLaden(key) {
  const indexPaket = await jsonDatei('./daten/index.enc.json');
  let gelesen;
  try {
    gelesen = await jsonEntschluesseln(indexPaket, key);
  } catch (problem) {
    if (istPasswortFalsch(problem)) throw problem;
    throw new Error('daten');
  }
  schluessel = key;
  index = gelesen;
  const { zeit } = zeitAusAdresse(location.search);
  const eintrag = aktiveReise(index, zeit);
  if (!eintrag?.id) throw new Error('keine-reise');
  await tripLaden(key, eintrag.id);
}

async function tripLaden(key, id) {
  const eintrag = (index?.reisen || []).find((reise) => reise.id === id);
  if (!eintrag?.id) throw new Error('keine-reise');
  const tripPaket = await jsonDatei(`./daten/${encodeURIComponent(eintrag.id)}/trip.enc.json`);
  let trip;
  try {
    trip = await jsonEntschluesseln(tripPaket, key);
  } catch (problem) {
    if (istPasswortFalsch(problem)) throw problem;
    throw new Error('daten');
  }
  fotoUrlsFreigeben();
  updates = [];
  neuIds = new Set();
  gewaehlteId = eintrag.id;
  zustand = { eintrag, trip };
  gesehenBeimStart = gesehenLesen(eintrag.id);
  await updatesAktualisieren();
}

function zeigeStatus() {
  passwortSchirm.hidden = true;
  statusSchirm.hidden = false;
  zeichne();
  if (timer) clearInterval(timer);
  timer = setInterval(zeichne, 60000);
  if (updatesTimer) clearInterval(updatesTimer);
  updatesTimer = setInterval(async () => {
    await updatesAktualisieren();
    if (!statusSchirm.hidden) zeichne();
  }, UPDATES_INTERVALL_MS);
}

async function zeichne() {
  if (!zustand) return;
  const zone = zustand.trip.zeitzone || 'Europe/Berlin';
  const { zeit, test } = zeitAusAdresse(location.search);
  if (test) {
    testzeit.hidden = false;
    testzeit.textContent = `Testzeit · ${uhrzeitLang(zeit, zone)}`;
  } else {
    testzeit.hidden = true;
  }
  const name = zustand.trip.titel || zustand.eintrag.titel || 'Reise';
  titel.textContent = name;
  document.title = name;
  if (zustand.trip.untertitel) {
    untertitel.hidden = false;
    untertitel.textContent = zustand.trip.untertitel;
  } else {
    untertitel.hidden = true;
    untertitel.textContent = '';
  }

  const status = getStatus(zustand.trip, zeit);
  const kartenText = statusKarte(status, zustand.trip, zustand.eintrag, zeit);
  statusZeile.textContent = kartenText.zeile;
  if (kartenText.info) {
    statusInfo.hidden = false;
    statusInfo.textContent = kartenText.info;
  } else {
    statusInfo.hidden = true;
    statusInfo.textContent = '';
  }
  if (kartenText.reisetag) {
    reiseBalken.hidden = false;
    const anteil = kartenText.reisetag.gesamt
      ? kartenText.reisetag.nummer / kartenText.reisetag.gesamt
      : 0;
    reiseFuellung.style.width = `${Math.max(0, Math.min(1, anteil)) * 100}%`;
    reiseText.textContent = kartenText.reisetag.text
      || `Reisetag ${kartenText.reisetag.nummer} von ${kartenText.reisetag.gesamt}`;
  } else {
    reiseBalken.hidden = true;
  }

  const gruppiert = updatesNachZeitraum(updates, zustand.eintrag, zone);
  tageZeichnen(tagesUebersicht(zustand.trip, zustand.eintrag, zeit), gruppiert.nachTag);
  extraZeitraumZeichnen(vorReise, 'Vor der Reise', gruppiert.vor);
  extraZeitraumZeichnen(nachReise, 'Nach der Reise', gruppiert.nach);
  linksZeichnen(zustand.trip.links);
  reisenZeichnen();

  if (karteLaeuft) return;
  try {
    if (!karte) {
      karteLaeuft = true;
      const modul = await import('./map.js');
      karte = await modul.karteErstellen(karteRahmen);
      karte.setzeOrtKlick((ort) => ortPopupZeigen(ort));
      karte.setzeGrussKlick((gruss) => vollbildOeffnen(gruss, updates));
      karteLaeuft = false;
    }
    karteFehler.hidden = true;
    karte.aktualisieren(zustand.trip, status, zeit, gruessePaket());
  } catch {
    karteLaeuft = false;
    karte = null;
    karteFehler.hidden = false;
  }
}

function tageZeichnen(tage, nachTag) {
  tageListe.replaceChildren();
  let heuteKarte = null;
  for (const tag of tage) {
    const artikel = document.createElement('article');
    artikel.className = `tag-karte ${tag.zustand}`;
    artikel.dataset.tag = tag.iso;
    if (tag.zustand === 'heute') heuteKarte = artikel;

    const kopf = document.createElement('p');
    kopf.className = 'tag-kopf';
    const datum = document.createElement('span');
    datum.className = 'tag-datum';
    datum.textContent = `${tag.wochentag}, ${tag.datum}`;
    kopf.append(datum);

    const ueberschrift = document.createElement('h3');
    ueberschrift.className = 'tag-titel';
    ueberschrift.textContent = tag.titel;

    const liste = document.createElement('ul');
    liste.className = 'tag-zeilen';
    for (const zeile of tag.zeilen) {
      const li = document.createElement('li');
      if (zeile.uhr) {
        const uhr = document.createElement('span');
        uhr.className = 'tag-uhr';
        uhr.textContent = zeile.uhr;
        const text = document.createElement('span');
        text.textContent = zeile.text;
        li.append(uhr, text);
      } else {
        li.className = 'ohne-uhr';
        li.textContent = zeile.text;
      }
      liste.append(li);
    }

    artikel.append(kopf, ueberschrift, liste);
    const tagesGruesse = nachTag?.get(tag.iso) || [];
    if (tagesGruesse.length > 0) artikel.append(galerieVon(tagesGruesse));
    tageListe.append(artikel);
  }

  const scrollSchluessel = `${gewaehlteId}:${heuteKarte?.dataset.tag || 'kein-heute'}`;
  if (heuteKarte && tageGescrolltFuer !== scrollSchluessel) {
    tageGescrolltFuer = scrollSchluessel;
    requestAnimationFrame(() => {
      heuteKarte.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
}

function linksZeichnen(links) {
  reiseLinks.replaceChildren();
  const liste = Array.isArray(links) ? links.filter((link) => sichererLink(link)) : [];
  if (liste.length === 0) {
    reiseLinks.hidden = true;
    return;
  }
  reiseLinks.hidden = false;
  for (const link of liste) {
    const a = document.createElement('a');
    a.className = 'link-knopf';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = link.text || link.url;
    reiseLinks.append(a);
  }
}

function sichererLink(link) {
  if (!link?.url || typeof link.url !== 'string') return false;
  try {
    const adresse = new URL(link.url, document.baseURI);
    return adresse.protocol === 'https:' || adresse.protocol === 'http:';
  } catch {
    return false;
  }
}

function reisenZeichnen() {
  const reisen = Array.isArray(index?.reisen) ? index.reisen : [];
  if (reisen.length < 2) {
    andereReisen.hidden = true;
    return;
  }
  andereReisen.hidden = false;
  reiseListe.replaceChildren();
  const sortiert = [...reisen].sort((a, b) => String(a.von).localeCompare(String(b.von)));
  for (const reise of sortiert) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = reise.id;
    button.textContent = reise.titel || reise.id;
    if (reise.id === gewaehlteId) button.setAttribute('aria-current', 'true');
    li.append(button);
    reiseListe.append(li);
  }
}

function extraZeitraumZeichnen(ziel, titel, liste) {
  ziel.replaceChildren();
  if (!liste.length) {
    ziel.hidden = true;
    return;
  }
  ziel.hidden = false;
  const artikel = document.createElement('article');
  artikel.className = 'tag-karte';
  const kopf = document.createElement('h3');
  kopf.className = 'tag-titel';
  kopf.textContent = titel;
  artikel.append(kopf, galerieVon(liste));
  ziel.append(artikel);
}

function galerieVon(liste) {
  const wrap = document.createElement('div');
  wrap.className = 'gruss-galerie';
  wrap.setAttribute('aria-label', 'Grüße und Fotos');
  for (const gruss of liste) wrap.append(kachelVon(gruss, liste));
  return wrap;
}

function kachelVon(gruss, liste) {
  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.className = 'gruss-kachel';
  knopf.addEventListener('click', () => vollbildOeffnen(gruss, liste));
  if (neuIds.has(gruss.id)) {
    const neu = document.createElement('span');
    neu.className = 'neu-punkt';
    neu.textContent = 'Neu!';
    knopf.append(neu);
  }
  const foto = (gruss.fotos || [])[0];
  if (foto) {
    const img = document.createElement('img');
    img.alt = `Foto von ${gruss.von || 'unterwegs'}`;
    knopf.append(img);
    lazyBild(img, () => fotoUrl(gewaehlteId, kleinPfad(foto), schluessel));
  } else {
    knopf.classList.add('gruss-kachel-text');
    const label = document.createElement('span');
    label.className = 'gruss-kachel-label';
    label.textContent = 'Gruß';
    knopf.append(label);
  }
  return knopf;
}

function slidesAus(liste) {
  const slides = [];
  for (const gruss of liste || []) {
    const fotos = gruss.fotos || [];
    if (fotos.length === 0) slides.push({ gruss, foto: null });
    else {
      for (const foto of fotos) slides.push({ gruss, foto });
    }
  }
  return slides;
}

function vollbildOeffnen(gruss, liste) {
  const quelle = Array.isArray(liste) && liste.length ? liste : updates;
  vollbildSlides = slidesAus(quelle);
  if (vollbildSlides.length === 0) return;
  const index = vollbildSlides.findIndex((slide) => slide.gruss.id === gruss.id);
  vollbildIndex = index >= 0 ? index : 0;
  vollbildZeigen();
  if (typeof vollbild.showModal === 'function') vollbild.showModal();
  else vollbild.setAttribute('open', '');
}

function vollbildSchritt(richtung) {
  if (vollbildSlides.length < 2) return;
  vollbildIndex = (vollbildIndex + richtung + vollbildSlides.length) % vollbildSlides.length;
  vollbildZeigen();
}

function vollbildZeigen() {
  const slide = vollbildSlides[vollbildIndex];
  if (!slide) return;
  const gruss = slide.gruss;
  const zone = zustand?.trip?.zeitzone || 'Europe/Berlin';
  vollbildText.textContent = gruss.text || '';
  vollbildText.hidden = !gruss.text;
  const wer = gruss.von ? `Gruß von ${gruss.von}` : 'Gruß';
  const relativ = vorRelativ(gruss.zeit);
  const absolut = zeitLang(gruss.zeit, zone);
  vollbildZeit.textContent = [wer, relativ, absolut].filter(Boolean).join(' · ');
  if (!slide.foto) {
    vollbildFoto.removeAttribute('src');
    vollbildFoto.hidden = true;
    vollbildOhneFoto.hidden = false;
    return;
  }
  vollbildOhneFoto.hidden = true;
  vollbildFoto.hidden = false;
  vollbildFoto.alt = `Foto von ${gruss.von || 'unterwegs'}`;
  const reiseId = gewaehlteId;
  const foto = slide.foto;
  fotoUrl(reiseId, kleinPfad(foto), schluessel).then((url) => {
    if (vollbildSlides[vollbildIndex]?.foto !== foto) return;
    vollbildFoto.src = url;
  }).catch(() => {
    if (vollbildSlides[vollbildIndex]?.foto === foto) {
      vollbildFoto.hidden = true;
      vollbildOhneFoto.hidden = false;
    }
  });
  const gross = grossPfad(foto);
  if (gross && gross !== kleinPfad(foto)) {
    fotoUrl(reiseId, gross, schluessel).then((url) => {
      if (vollbildSlides[vollbildIndex]?.foto !== foto) return;
      vollbildFoto.src = url;
    }).catch(() => {});
  }
}

function vollbildSchliessenJetzt() {
  if (vollbild.open) vollbild.close();
  else vollbild.removeAttribute('open');
}

function zeitLang(iso, zone) {
  const zeit = new Date(iso);
  if (Number.isNaN(zeit.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: zone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(zeit);
  } catch {
    return '';
  }
}

function gruessePaket() {
  return {
    updates,
    neuester: neuesterGruss(updates),
    neuIds,
    fotoUrl: (foto) => fotoUrl(gewaehlteId, kleinPfad(foto), schluessel),
  };
}

async function updatesAktualisieren() {
  if (!schluessel || !gewaehlteId) return;
  const fuer = gewaehlteId;
  const liste = await updatesLaden(gewaehlteId, schluessel);
  if (fuer !== gewaehlteId) return;
  updates = liste;
  neuIds = new Set(liste.filter((eintrag) => !gesehenBeimStart.has(eintrag.id)).map((eintrag) => eintrag.id));
}

function gesehenLesen(reiseId) {
  try {
    const roh = JSON.parse(localStorage.getItem(SPEICHER_GESEHEN) || '{}');
    const liste = roh && Array.isArray(roh[reiseId]) ? roh[reiseId] : [];
    return new Set(liste.filter((id) => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function gesehenSchreiben() {
  if (!gewaehlteId) return;
  try {
    const roh = JSON.parse(localStorage.getItem(SPEICHER_GESEHEN) || '{}');
    const alt = roh && typeof roh === 'object' ? roh : {};
    alt[gewaehlteId] = updates.map((eintrag) => eintrag.id);
    localStorage.setItem(SPEICHER_GESEHEN, JSON.stringify(alt));
  } catch {
    // Privater Modus: ohne Speicher gibt es keinen Neu!-Punkt.
  }
}

function ortPopupZeigen(ort) {
  const daten = ortPopup(ort, zustand?.trip);
  if (!daten) return;
  ortName.textContent = daten.name || 'Ort';
  if (daten.land) {
    ortLand.hidden = false;
    ortLand.textContent = daten.land;
  } else {
    ortLand.hidden = true;
    ortLand.textContent = '';
  }
  if (daten.zeiten) {
    ortZeiten.hidden = false;
    ortZeiten.textContent = daten.zeiten;
  } else {
    ortZeiten.hidden = true;
    ortZeiten.textContent = '';
  }
  if (daten.info) {
    ortInfo.hidden = false;
    ortInfo.textContent = daten.info;
  } else {
    ortInfo.hidden = true;
    ortInfo.textContent = '';
  }
  if (typeof ortDialog.showModal === 'function') ortDialog.showModal();
  else ortDialog.setAttribute('open', '');
}

function zeigePasswort() {
  if (timer) clearInterval(timer);
  timer = null;
  if (updatesTimer) clearInterval(updatesTimer);
  updatesTimer = null;
  if (ortDialog.open) ortDialog.close();
  if (vollbild.open) vollbild.close();
  statusSchirm.hidden = true;
  passwortSchirm.hidden = false;
  document.title = 'Reisetracker';
}

function abmelden() {
  gesehenSchreiben();
  if (karte) {
    karte.zerstoeren();
    karte = null;
  }
  if (ortDialog.open) ortDialog.close();
  if (vollbild.open) vollbild.close();
  fotoUrlsFreigeben();
  schluesselVergessen();
  schluessel = null;
  index = null;
  zustand = null;
  gewaehlteId = null;
  tageGescrolltFuer = null;
  updates = [];
  neuIds = new Set();
  gesehenBeimStart = new Set();
  tageListe.replaceChildren();
  vorReise.replaceChildren();
  vorReise.hidden = true;
  nachReise.replaceChildren();
  nachReise.hidden = true;
  reiseLinks.replaceChildren();
  reiseLinks.hidden = true;
  andereReisen.hidden = true;
  andereReisen.open = false;
  eingabe.value = '';
  fehler.hidden = true;
  merkenHinweis.hidden = true;
  zeigePasswort();
  eingabe.focus();
}

function zeigeFehler(text) {
  fehler.textContent = text;
  fehler.hidden = false;
}

function meldungFuer(problem) {
  if (istPasswortFalsch(problem)) return 'Das Passwort stimmt leider nicht.';
  if (problem?.code === 404) {
    return 'Die verschlüsselten Reisedaten fehlen noch. Bitte das Skript ausführen und die Seite neu laden.';
  }
  return 'Das hat leider nicht geklappt. Bitte später noch einmal versuchen.';
}

function istPasswortFalsch(problem) {
  return problem?.name === 'OperationError';
}

/** Pfade wie ./daten/... gelten ab der Seite, nicht ab der Skriptdatei. */
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

function schluesselLesen() {
  try {
    return localStorage.getItem(SPEICHER);
  } catch {
    return null;
  }
}

function schluesselMerken(wert) {
  try {
    localStorage.setItem(SPEICHER, wert);
    return true;
  } catch {
    return false;
  }
}

function schluesselVergessen() {
  try {
    localStorage.removeItem(SPEICHER);
  } catch {
    // Privater Modus oder gesperrter Speicher: dann ist nichts zu löschen.
  }
}

function serviceWorkerAnmelden() {
  if (!('serviceWorker' in navigator)) return;
  const adresse = new URL('./sw.js', document.baseURI);
  navigator.serviceWorker.register(adresse.href).catch(() => {
    // Ohne HTTPS oder auf file:// gibt es keinen Worker. Die Seite läuft trotzdem.
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (serviceWorkerNeu) return;
    serviceWorkerNeu = true;
    location.reload();
  });
}
