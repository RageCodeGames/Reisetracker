/**
 * Passwort, Entschlüsseln, Status als Text.
 * Der Schlüssel (nie das Passwort) bleibt auf diesem Gerät, bis jemand abmeldet.
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
  statusBeschreiben,
  uhrzeitLang,
  zeitAusAdresse,
} from './trip.js';

const SPEICHER = 'reisetracker.schluessel';

const passwortSchirm = document.querySelector('#passwort-schirm');
const statusSchirm = document.querySelector('#status-schirm');
const formular = document.querySelector('#passwort-formular');
const eingabe = document.querySelector('#passwort');
const fehler = document.querySelector('#passwort-fehler');
const knopf = formular.querySelector('button');
const testzeit = document.querySelector('#testzeit');
const titel = document.querySelector('#reise-titel');
const untertitel = document.querySelector('#reise-untertitel');
const statusText = document.querySelector('#status-text');
const merkenHinweis = document.querySelector('#merken-hinweis');
const abmeldenKnopf = document.querySelector('#abmelden');

let konfig = null;
let zustand = null;
let timer = null;

formular.addEventListener('submit', async (ereignis) => {
  ereignis.preventDefault();
  fehler.hidden = true;
  const passwort = eingabe.value;
  knopf.disabled = true;
  const alterText = knopf.textContent;
  knopf.textContent = 'Einen Moment …';
  try {
    const key = await schluesselAbleiten(passwort, bytesAusBase64(konfig.salt), konfig.iterationen);
    await reiseLaden(key);
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

start();

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
      await reiseLaden(key);
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

async function reiseLaden(key) {
  const indexPaket = await jsonDatei('./daten/index.enc.json');
  let index;
  try {
    index = await jsonEntschluesseln(indexPaket, key);
  } catch (problem) {
    if (istPasswortFalsch(problem)) throw problem;
    throw new Error('daten');
  }
  const { zeit } = zeitAusAdresse(location.search);
  const eintrag = aktiveReise(index, zeit);
  if (!eintrag?.id) throw new Error('keine-reise');
  const tripPaket = await jsonDatei(`./daten/${encodeURIComponent(eintrag.id)}/trip.enc.json`);
  let trip;
  try {
    trip = await jsonEntschluesseln(tripPaket, key);
  } catch (problem) {
    if (istPasswortFalsch(problem)) throw problem;
    throw new Error('daten');
  }
  zustand = { eintrag, trip };
}

function zeigeStatus() {
  passwortSchirm.hidden = true;
  statusSchirm.hidden = false;
  zeichne();
  if (timer) clearInterval(timer);
  timer = setInterval(zeichne, 30000);
}

function zeichne() {
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
  const zeilen = statusBeschreiben(status, zustand.trip);
  const absatz = zeilen.map((text) => {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  });
  statusText.replaceChildren(...absatz);
}

function zeigePasswort() {
  if (timer) clearInterval(timer);
  timer = null;
  statusSchirm.hidden = true;
  passwortSchirm.hidden = false;
  document.title = 'Reisetracker';
}

function abmelden() {
  schluesselVergessen();
  zustand = null;
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
