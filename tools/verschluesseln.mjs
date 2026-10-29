/**
 * Verschlüsselt die Klartext-Reise aus privat/ nach daten/.
 * Nur Node-Bordmittel. Aufruf: node tools/verschluesseln.mjs
 *
 * privat/index.json            -> daten/index.enc.json
 * privat/<ordner>/trip.json    -> daten/<id>/trip.enc.json
 * Die id stammt aus der Datei, damit sie zum Index passt.
 * Dateien in privat/ werden nur gelesen, nie verändert.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { bytesAusBase64, jsonVerschluesseln, schluesselAbleiten } from '../js/crypto.js';

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function allesVerschluesseln(passwort, optionen = {}) {
  const basis = optionen.wurzel ?? wurzel;
  const konfig = jsonLesen(join(basis, 'config.json'));
  if (!konfig.salt || !konfig.iterationen) {
    throw new Error('config.json braucht "salt" und "iterationen".');
  }
  const key = await schluesselAbleiten(passwort, bytesAusBase64(konfig.salt), konfig.iterationen);
  const privat = join(basis, 'privat');

  const indexPfad = join(privat, 'index.json');
  jsonLesen(indexPfad);
  await schreibeVerschluesselt(basis, indexPfad, join(basis, 'daten', 'index.enc.json'), key);

  let eintraege;
  try {
    eintraege = readdirSync(privat, { withFileTypes: true });
  } catch {
    throw new Error('Der Ordner privat/ fehlt.');
  }
  for (const eintrag of eintraege) {
    if (!eintrag.isDirectory()) continue;
    const quelle = join(privat, eintrag.name, 'trip.json');
    if (!existiert(quelle)) continue;
    const trip = jsonLesen(quelle);
    const id = sichereId(trip.id || eintrag.name);
    if (trip.id && trip.id !== eintrag.name) {
      console.log(`Hinweis: Ordner "${eintrag.name}" hat die id "${id}". Ausgabe ist daten/${id}/trip.enc.json.`);
    }
    await schreibeVerschluesselt(basis, quelle, join(basis, 'daten', id, 'trip.enc.json'), key);
  }
}

async function schreibeVerschluesselt(basis, quelle, ziel, key) {
  const text = readFileSync(quelle, 'utf8');
  const paket = await jsonVerschluesseln(text, key);
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, `${JSON.stringify(paket, null, 2)}\n`, 'utf8');
  console.log(`Verschlüsselt: ${relative(basis, ziel).split('\\').join('/')}`);
}

function jsonLesen(pfad) {
  let text;
  try {
    text = readFileSync(pfad, 'utf8');
  } catch {
    throw new Error(`Datei fehlt: ${pfad}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Keine gültige JSON-Datei: ${pfad}`);
  }
}

function existiert(pfad) {
  try {
    return statSync(pfad).isFile();
  } catch {
    return false;
  }
}

function sichereId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
    throw new Error('Die Reise-id enthält unerlaubte Zeichen.');
  }
  return id;
}

function passwortAbfragen() {
  return new Promise((resolveFertig, reject) => {
    const runde = async () => {
      const erstes = await frageVerdeckt('Familien-Passwort: ');
      const zweites = await frageVerdeckt('Noch einmal: ');
      if (erstes.length === 0) {
        console.log('Bitte ein Passwort eingeben.');
        runde();
        return;
      }
      if (erstes !== zweites) {
        console.log('Die beiden Eingaben sind nicht gleich. Bitte noch einmal.');
        runde();
        return;
      }
      resolveFertig(erstes);
    };
    runde().catch(reject);
  });
}

function frageVerdeckt(text) {
  return new Promise((resolveFertig) => {
    stdout.write(text);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let wert = '';

    const aufraeumen = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (zeichen) => {
      if (zeichen === '\u0003') {
        aufraeumen();
        stdout.write('\n');
        process.exit(130);
      }
      if (zeichen.startsWith('\u001b')) return;
      if (zeichen.includes('\r') || zeichen.includes('\n') || zeichen.includes('\u0004')) {
        wert += zeichen.split(/\r|\n|\u0004/)[0];
        aufraeumen();
        stdout.write('\n');
        resolveFertig(wert);
        return;
      }
      if (zeichen === '\u007f' || zeichen === '\b') {
        wert = wert.slice(0, -1);
        return;
      }
      if (zeichen.length === 1 && zeichen < ' ') return;
      wert += zeichen;
    };

    stdin.on('data', onData);
  });
}

function wirdDirektAusgefuehrt() {
  const arg = process.argv[1];
  if (!arg) return false;
  return resolve(fileURLToPath(import.meta.url)) === resolve(arg);
}

async function main() {
  if (!stdin.isTTY) {
    throw new Error('Bitte das Skript in einem normalen Terminal starten, damit das Passwort verdeckt eingegeben werden kann.');
  }
  const passwort = await passwortAbfragen();
  console.log('Schlüssel wird abgeleitet, das kann einen Moment dauern …');
  await allesVerschluesseln(passwort);
  console.log('Fertig. Die Dateien in privat/ wurden nicht verändert.');
}

if (wirdDirektAusgefuehrt()) {
  main().catch((fehler) => {
    console.error(fehler.message || 'Das Verschlüsseln ist fehlgeschlagen.');
    process.exitCode = 1;
  });
}
