/**
 * Push-Texte je Reisesituation.
 * Paare: Titel | Text. Platzhalter {n}, {name}, {ort}.
 * Später leicht um Flug, Fähre, Strand usw. erweiterbar.
 */

/** @typedef {{ titel: string, text: string }} PushPaar */

/** @type {Record<string, PushPaar[]>} */
export const PUSH_TEXTE = {
  vorReise: [
    { titel: '🧳 Die Koffer sind fast gepackt', text: '{name} schickt {n}' },
    { titel: '🏡 Noch in {ort}, aber schon im Urlaubsmodus', text: '{n} von {name}' },
    { titel: "⏳ Gleich geht's los!", text: '{n} vor der Abfahrt' },
  ],
  nachtzug: [
    { titel: '🚂💤 Grüße aus dem Nachtzug', text: '{n} auf dem Weg nach {ort}' },
    { titel: '🌙 Rattern durch die Nacht', text: '{name} kann nicht schlafen: {n}' },
  ],
  zug: [
    { titel: '🚆 Unterwegs nach {ort}', text: '{n} von {name}' },
    { titel: '🛤️ Die Landschaft fliegt vorbei', text: '{n} aus dem Zug' },
  ],
  bahnhof: [
    { titel: '🚉 Umsteigen in {ort}', text: '{n} von {name}' },
  ],
  hotel: [
    { titel: '🏨 Grüße aus {ort}', text: '{n} von {name}' },
    { titel: '🌆 Stadtbummel vor dem Ablegen', text: '{n} aus {ort}' },
  ],
  hafen: [
    { titel: '⚓ Landgang in {ort}!', text: '{n} von {name}' },
    { titel: '🗺️ Neuer Hafen: {ort}', text: '{name} schickt {n}' },
    { titel: '🐟 Frisch vom Kai in {ort}', text: '{n}' },
  ],
  see: [
    { titel: '🌊 Grüße von hoher See', text: '{n} von Bord' },
    { titel: '🚢 Ahoi!', text: '{name} meldet sich von Deck, Kurs {ort}: {n}' },
    { titel: '🧭 Nächster Halt: {ort}', text: '{n} zwischen den Wellen' },
    { titel: '🐬 Flaschenpost!', text: '{n} von {name}' },
  ],
  nachReise: [
    { titel: '🏠 Wieder daheim', text: 'Noch {n} von der Reise' },
    { titel: '📸 Nachschlag!', text: '{n} aus dem Urlaub' },
  ],
};

/** Auswahlfelder für die Testbenachrichtigung. */
export const PUSH_TEST_OPTIONEN = [
  { id: 'vorReise', label: 'Zuhause / vor der Reise' },
  { id: 'nachtzug', label: 'Nachtzug' },
  { id: 'zug', label: 'Zug / S-Bahn / Taxi' },
  { id: 'bahnhof', label: 'Bahnhof' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'hafen', label: 'Hafen' },
  { id: 'see', label: 'Auf See' },
  { id: 'nachReise', label: 'Nach der Reise' },
];

let letzterSchluessel = '';

/**
 * Situation aus dem Reise-Status (getStatus).
 * zeit/zone nur für Nachtzug (21–6 Uhr).
 */
export function situationAusStatus(status, zeit, zone = 'Europe/Berlin') {
  if (!status) return 'vorReise';
  if (status.status === 'vorReise') return 'vorReise';
  if (status.status === 'nachReise') return 'nachReise';
  if (status.status === 'fahrt') {
    if (status.modus === 'schiff' || status.seetag) return 'see';
    if (status.modus === 'zug' && istNachtLokal(zeit, zone)) return 'nachtzug';
    return 'zug';
  }
  if (status.status === 'ort') {
    if (status.ortArt === 'zuhause') return 'vorReise';
    if (status.ortArt === 'bahnhof') return 'bahnhof';
    if (status.ortArt === 'hafen') return 'hafen';
    if (status.ortArt === 'hotel') return 'hotel';
    return 'hotel';
  }
  return 'vorReise';
}

/** Ort für {ort}: bei Fahrt das Ziel, sonst der aktuelle Name. */
export function ortAusStatus(status, trip = null) {
  if (status?.status === 'fahrt') {
    return status.nach?.name || 'unterwegs';
  }
  if (status?.name) return status.name;
  const plan = trip?.plan || [];
  const erster = plan.find((e) => e.typ === 'ort' && e.name);
  return erster?.name || 'Zuhause';
}

/**
 * Passender echter Ort aus dem Reiseplan für Test-Situationen.
 * Hafen → erster Hafen, Hotel → Hotel, Zug → Ziel einer Zugfahrt, usw.
 */
export function ortFuerSituation(trip, situation) {
  const plan = Array.isArray(trip?.plan) ? trip.plan : [];
  const ortMitArt = (art) => plan.find((e) => e.typ === 'ort' && e.art === art && e.name)?.name;
  const zielNachFahrt = (modus) => {
    for (let i = 0; i < plan.length; i += 1) {
      const eintrag = plan[i];
      if (eintrag.typ !== 'fahrt') continue;
      if (modus && eintrag.modus !== modus) continue;
      const ziel = plan[i + 1];
      if (ziel?.typ === 'ort' && ziel.name) return ziel.name;
    }
    return null;
  };

  if (situation === 'vorReise' || situation === 'nachReise') {
    return ortMitArt('zuhause') || plan.find((e) => e.typ === 'ort' && e.name)?.name || 'Zuhause';
  }
  if (situation === 'hafen') {
    return ortMitArt('hafen') || zielNachFahrt('schiff') || 'Hafen';
  }
  if (situation === 'hotel') {
    return ortMitArt('hotel') || plan.find((e) => e.typ === 'ort' && e.name && e.art !== 'zuhause')?.name || 'Hotel';
  }
  if (situation === 'bahnhof') {
    return ortMitArt('bahnhof') || zielNachFahrt('zug') || zielNachFahrt('sbahn') || 'Bahnhof';
  }
  if (situation === 'nachtzug' || situation === 'zug') {
    return zielNachFahrt('zug') || zielNachFahrt('sbahn') || zielNachFahrt('taxi') || zielNachFahrt(null) || 'unterwegs';
  }
  if (situation === 'see') {
    return zielNachFahrt('schiff') || ortMitArt('hafen') || 'See';
  }
  return plan.find((e) => e.typ === 'ort' && e.name)?.name || 'unterwegs';
}

/** {n}: Fotozahl oder „ein neuer Gruß“. */
export function nText(fotoZahl) {
  const n = Number(fotoZahl) || 0;
  if (n <= 0) return 'ein neuer Gruß';
  if (n === 1) return '1 neues Foto';
  return `${n} neue Fotos`;
}

/**
 * Zufälliges Titel/Text-Paar für eine Situation.
 * Nicht zweimal hintereinander dasselbe Paar.
 */
export function pushTextWaehlen(situation, { name = 'unterwegs', fotoZahl = 0, ort = 'unterwegs' } = {}) {
  const liste = PUSH_TEXTE[situation] || PUSH_TEXTE.vorReise;
  const paar = zufallsPaar(liste, situation);
  const n = nText(fotoZahl);
  return {
    titel: einsetzen(paar.titel, { n, name, ort }),
    text: einsetzen(paar.text, { n, name, ort }),
    situation,
  };
}

/** Sammel-Benachrichtigung: Titel aus Situation, Text mit Anzahlen. */
export function pushSammelText(situation, { anzahl, fotos, name = 'unterwegs', ort = 'unterwegs' }) {
  const liste = PUSH_TEXTE[situation] || PUSH_TEXTE.vorReise;
  const paar = zufallsPaar(liste, situation);
  const n = nText(fotos);
  const titel = einsetzen(paar.titel, { n, name, ort });
  const text = `${anzahl} neue Grüße mit ${fotos} Fotos`;
  return { titel, text, situation };
}

function zufallsPaar(liste, situation) {
  if (liste.length === 1) return liste[0];
  const kandidaten = liste.filter((paar) => `${situation}|${paar.titel}|${paar.text}` !== letzterSchluessel);
  const pool = kandidaten.length > 0 ? kandidaten : liste;
  const paar = pool[Math.floor(Math.random() * pool.length)];
  letzterSchluessel = `${situation}|${paar.titel}|${paar.text}`;
  return paar;
}

function einsetzen(vorlage, werte) {
  return String(vorlage)
    .replaceAll('{n}', werte.n)
    .replaceAll('{name}', werte.name)
    .replaceAll('{ort}', werte.ort);
}

function istNachtLokal(zeit, zone) {
  try {
    const date = zeit instanceof Date ? zeit : new Date(zeit);
    if (Number.isNaN(date.getTime())) return false;
    const stunde = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).find((t) => t.type === 'hour')?.value);
    return stunde >= 21 || stunde < 6;
  } catch {
    return false;
  }
}
