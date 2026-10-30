/**
 * Rechenlogik für den Reiseplan. Keine Live-Daten.
 *
 * plan wechselt sich ab: "ort" (Aufenthalt, von/bis, art) und "fahrt"
 * (ab/an, modus, optional wegpunkte als [lat, lon]).
 * Eine Fahrt läuft vom Ort davor über die Wegpunkte zum Ort danach.
 * Die Position wandert linear mit der Zeit, gewichtet nach Streckenlänge.
 */

const MODUS_NAME = {
  zug: 'Zug',
  sbahn: 'S-Bahn',
  taxi: 'Taxi',
  schiff: 'Schiff',
};

const ORT_ART_NAME = {
  zuhause: 'Zuhause',
  bahnhof: 'Bahnhof',
  hotel: 'Hotel',
  hafen: 'Hafen',
};

/**
 * Reise, in deren Zeitraum der Zeitpunkt liegt.
 * Sonst die nächste kommende, sonst die letzte.
 * von/bis im Index sind Kalendertage; verglichen wird das lokale Datum.
 */
export function aktiveReise(index, zeitpunkt) {
  const liste = Array.isArray(index?.reisen) ? index.reisen : [];
  if (liste.length === 0) return null;
  const sortiert = [...liste].sort((a, b) => String(a.von).localeCompare(String(b.von)));
  const tag = lokalesDatum(zeitpunkt);
  const laufend = sortiert.find((reise) => reise.von <= tag && tag <= reise.bis);
  if (laufend) return laufend;
  const kommend = sortiert.find((reise) => reise.von > tag);
  if (kommend) return kommend;
  return sortiert[sortiert.length - 1];
}

/**
 * Status zum Zeitpunkt: vorReise, ort, fahrt oder nachReise.
 * Ein führender Ort ohne "von" gilt ab der Mitternacht seines Tages
 * (in der Zeitzone der Reise). Davor ist es der Countdown.
 * Ein letzter Ort ohne "bis" ist das Ende: nachReise.
 */
export function getStatus(trip, zeitpunkt) {
  const zeit = alsDatum(zeitpunkt) ?? (zeitpunkt instanceof Date ? zeitpunkt : new Date(zeitpunkt));
  const titel = trip?.titel || '';
  if (!(zeit instanceof Date) || Number.isNaN(zeit.getTime())) {
    return { status: 'vorReise', ziel: null, restMs: null, titel };
  }

  const zone = trip?.zeitzone || 'Europe/Berlin';
  const plan = Array.isArray(trip?.plan) ? trip.plan : [];
  const fenster = zeitfenster(plan, zone);
  if (fenster.length === 0) {
    return { status: 'vorReise', ziel: null, restMs: null, titel };
  }

  const ersterStart = fenster[0].fensterStart;
  if (ersterStart && zeit < ersterStart) {
    return {
      status: 'vorReise',
      ziel: ersterStart,
      restMs: ersterStart.getTime() - zeit.getTime(),
      titel,
    };
  }

  const heute = tagIso(zeit, zone);
  const seetag = new Set(seetage(trip)).has(heute);

  for (const seg of fenster) {
    if (!seg.fensterStart || zeit < seg.fensterStart) continue;
    if (seg.fensterEnde && zeit >= seg.fensterEnde) continue;

    const letzter = seg.index === plan.length - 1;
    if (letzter && seg.typ === 'ort' && !seg.originalEnde) {
      return nachReiseStatus(seg.eintrag, seg.originalStart, titel);
    }
    if (seg.typ === 'ort') return ortStatus(seg, plan);
    return fahrtStatus(seg, zeit, seetag);
  }

  const letzter = fenster[fenster.length - 1];
  return nachReiseStatus(
    letzter?.eintrag || {},
    letzter?.originalEnde || letzter?.originalStart || null,
    titel,
  );
}

function nachReiseStatus(eintrag, seit, titel) {
  return {
    status: 'nachReise',
    name: eintrag.name || '',
    info: eintrag.info || null,
    seit,
    titel,
    lat: eintrag.lat,
    lon: eintrag.lon,
    ortArt: eintrag.art || '',
  };
}

/**
 * Kalendertage, die komplett in einer Schiffsfahrt liegen.
 * Rückgabe: ["2026-11-08", ...] in der Zeitzone der Reise.
 */
export function seetage(trip) {
  const zone = trip?.zeitzone || 'Europe/Berlin';
  const tage = [];
  const gesehen = new Set();
  for (const eintrag of trip?.plan || []) {
    if (eintrag.typ !== 'fahrt' || eintrag.modus !== 'schiff') continue;
    const ab = alsDatum(eintrag.ab);
    const an = alsDatum(eintrag.an);
    if (!ab || !an || an <= ab) continue;
    let iso = tagIso(ab, zone);
    for (let n = 0; n < 400; n += 1) {
      const start = mitternachtVonIso(iso, zone);
      const naechster = naechsterKalendertag(iso, zone);
      if (start >= an) break;
      if (start >= ab && naechster.start <= an && !gesehen.has(iso)) {
        gesehen.add(iso);
        tage.push(iso);
      }
      if (naechster.start <= start) break;
      iso = naechster.iso;
    }
  }
  return tage;
}

/** Kurze deutsche Sätze zum Prüfen der Logik. */
export function statusBeschreiben(status, trip) {
  const zone = trip?.zeitzone || 'Europe/Berlin';
  const zeilen = [];

  if (status.status === 'vorReise') {
    zeilen.push('Die Reise hat noch nicht begonnen.');
    if (status.restMs != null) zeilen.push(`Noch ${undListe(dauerTeile(status.restMs))}.`);
    if (status.ziel) zeilen.push(`Beginn: ${zeitText(status.ziel, zone)}.`);
  } else if (status.status === 'ort') {
    let kopf = `Gerade in ${status.name}`;
    if (status.land) kopf += `, ${status.land}`;
    zeilen.push(`${kopf}.`);
    if (status.ortArt && ORT_ART_NAME[status.ortArt]) zeilen.push(`${ORT_ART_NAME[status.ortArt]}.`);
    if (status.info) zeilen.push(status.info);
    const seit = status.seit ? zeitText(status.seit, zone) : null;
    const bis = status.bis ? zeitText(status.bis, zone) : null;
    if (seit && bis) zeilen.push(`Seit ${seit}, bis ${bis}.`);
    else if (bis) zeilen.push(`Bis ${bis}.`);
    else if (seit) zeilen.push(`Seit ${seit}.`);
    if (status.danach?.typ === 'fahrt') {
      const modus = MODUS_NAME[status.danach.modus] || 'Weiterfahrt';
      let satz = `Danach: ${modus} „${status.danach.name}“`;
      if (status.danach.ziel) satz += ` nach ${status.danach.ziel}`;
      zeilen.push(`${satz}.`);
    } else if (status.danach?.name) {
      zeilen.push(`Danach: ${status.danach.name}.`);
    }
  } else if (status.status === 'fahrt') {
    zeilen.push(`Unterwegs mit ${mitModus(status.modus)}: ${status.name}.`);
    if (status.von?.name && status.nach?.name) {
      zeilen.push(`Von ${status.von.name} nach ${status.nach.name}.`);
    }
    if (status.ab && status.an) {
      zeilen.push(`Abfahrt ${zeitText(status.ab, zone)}, Ankunft ${zeitText(status.an, zone)}.`);
    }
    zeilen.push(`Geschafft: ${prozentText(status.fortschritt)}.`);
    zeilen.push(`Noch ${undListe(dauerTeile(status.restMs))}.`);
    if (status.position) zeilen.push(`Position: ${koordinatenText(status.position.lat, status.position.lon)}.`);
    if (status.richtung) zeilen.push(`Richtung: ${status.richtung}.`);
    if (status.info) zeilen.push(status.info);
    if (status.seetag) zeilen.push('Heute ist ein Seetag.');
  } else {
    zeilen.push('Die Reise ist vorbei.');
    if (status.name) zeilen.push(`Jetzt: ${status.name}.`);
    if (status.info) zeilen.push(status.info);
    if (status.seit) zeilen.push(`Seit ${zeitText(status.seit, zone)}.`);
  }

  const seetageZeile = seetageSatz(trip);
  if (seetageZeile) zeilen.push(seetageZeile);
  return zeilen;
}

/**
 * Große Statuszeile für die Karte, dazu Info und Reisetag.
 * Nacht gilt von 21 bis 6 Uhr in der Zeitzone der Reise.
 */
export function statusKarte(status, trip, eintrag, zeitpunkt) {
  const zone = trip?.zeitzone || 'Europe/Berlin';
  const zeit = alsDatum(zeitpunkt) ?? new Date(zeitpunkt);
  const nacht = istNacht(zeit, zone);
  const tag = reisetagStand(eintrag, zeit, zone);
  let zeile = 'Unterwegs';
  let info = status?.info || null;

  if (status?.status === 'vorReise') {
    zeile = countdownZeile(status);
    info = null;
  } else if (status?.status === 'nachReise') {
    zeile = '🏠 Wieder zu Hause!';
  } else if (status?.status === 'ort') {
    zeile = ortZeile(status, zeit, zone);
  } else if (status?.status === 'fahrt') {
    zeile = fahrtZeile(status, zone);
  }

  return { zeile, info, reisetag: tag, nacht };
}

/** true zwischen 21 und 6 Uhr in der angegebenen Zeitzone. */
export function istNacht(zeitpunkt, zone = 'Europe/Berlin') {
  const zeit = alsDatum(zeitpunkt);
  if (!zeit) return false;
  const stunde = teileInZone(zeit, zone).stunde;
  return stunde >= 21 || stunde < 6;
}

/**
 * Reisetag innerhalb von von/bis, beide Tage mitgezählt.
 * Vor der Reise ist die Nummer 0, danach die Gesamtzahl.
 */
export function reisetagStand(eintrag, zeitpunkt, zone = 'Europe/Berlin') {
  if (!eintrag?.von || !eintrag?.bis) return null;
  const zeit = alsDatum(zeitpunkt) ?? new Date(zeitpunkt);
  const heute = tagIso(zeit, zone);
  const gesamt = tageZwischen(eintrag.von, eintrag.bis) + 1;
  let nummer = tageZwischen(eintrag.von, heute) + 1;
  if (heute < eintrag.von) nummer = 0;
  if (heute > eintrag.bis) nummer = gesamt;
  if (nummer < 0) nummer = 0;
  if (nummer > gesamt) nummer = gesamt;
  let text = `Reisetag ${nummer} von ${gesamt}`;
  if (nummer === 0) {
    const mittag = new Date(mitternachtVonIso(eintrag.von, zone).getTime() + 12 * 60 * 60 * 1000);
    const datum = new Intl.DateTimeFormat('de-DE', {
      timeZone: zone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(mittag);
    text = `Abfahrt am ${datum}`;
  }
  return { nummer, gesamt, text };
}

/** Punkte einer Fahrt: Ort davor, Wegpunkte, Ort danach. */
export function fahrtPunkte(vonOrt, fahrt, nachOrt) {
  return routenpunkte({ vonOrt, nachOrt, eintrag: fahrt || {} });
}

/**
 * Eine Karte pro Kalendertag von Index-von bis Index-bis.
 * Seetag, Ort am Mittag, Zeiten und Infos; zustand vergangen/heute/kommend.
 */
export function tagesUebersicht(trip, eintrag, zeitpunkt) {
  if (!eintrag?.von || !eintrag?.bis) return [];
  const zone = trip?.zeitzone || 'Europe/Berlin';
  const zeit = alsDatum(zeitpunkt) ?? new Date(zeitpunkt);
  const heute = tagIso(zeit, zone);
  const seetagSet = new Set(seetage(trip));
  const fenster = zeitfenster(Array.isArray(trip?.plan) ? trip.plan : [], zone);
  const tage = [];
  let iso = eintrag.von;
  for (let n = 0; n < 400; n += 1) {
    if (iso > eintrag.bis) break;
    tage.push(tagKarte(iso, heute, seetagSet.has(iso), fenster, zone, trip));
    const weiter = naechsterKalendertag(iso, zone);
    if (weiter.iso <= iso) break;
    iso = weiter.iso;
  }
  return tage;
}

/** Name, Land, Zeiten und Info für das Comic-Popup einer Nadel. */
export function ortPopup(ort, trip) {
  if (!ort) return null;
  const zone = trip?.zeitzone || 'Europe/Berlin';
  const zeiten = [];
  if (ort.von) zeiten.push(`Ankunft ${uhrKurz(alsDatum(ort.von), zone)}`);
  if (ort.bis) zeiten.push(`Abfahrt ${uhrKurz(alsDatum(ort.bis), zone)}`);
  else if (ort.von && !ort.bis) zeiten.push('Danach zu Hause');
  return {
    name: ort.name || '',
    land: ort.land || '',
    art: ort.art || '',
    zeiten: zeiten.join(' · '),
    info: ort.info || null,
  };
}

/**
 * Teilt die Linie bei einem Zeitanteil 0..1.
 * Der Schnitt liegt nach Streckenlänge, nicht nach Punktzahl.
 */
export function streckeTeilen(punkte, anteil) {
  if (!punkte?.length) return { gefahren: [], kommend: [] };
  if (anteil <= 0) return { gefahren: [], kommend: punkte.slice() };
  if (anteil >= 1) return { gefahren: punkte.slice(), kommend: [] };

  const laengen = [];
  let gesamt = 0;
  for (let i = 0; i < punkte.length - 1; i += 1) {
    const laenge = distanzMeter(punkte[i], punkte[i + 1]);
    laengen.push(laenge);
    gesamt += laenge;
  }
  if (gesamt === 0) return { gefahren: punkte.slice(), kommend: [] };

  let rest = anteil * gesamt;
  const gefahren = [punkte[0]];
  for (let i = 0; i < laengen.length; i += 1) {
    const a = punkte[i];
    const b = punkte[i + 1];
    if (laengen[i] > 0 && rest < laengen[i]) {
      const t = rest / laengen[i];
      const mitte = {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      };
      gefahren.push(mitte);
      return { gefahren, kommend: [mitte, ...punkte.slice(i + 1)] };
    }
    rest -= laengen[i];
    gefahren.push(b);
  }
  return { gefahren: punkte.slice(), kommend: [] };
}

function tagKarte(iso, heute, istSeetag, fenster, zone, trip) {
  const start = mitternachtVonIso(iso, zone);
  const ende = naechsterKalendertag(iso, zone).start;
  const mittag = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  const wochentag = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    weekday: 'long',
  }).format(mittag);
  const datum = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    day: 'numeric',
    month: 'long',
  }).format(mittag);

  let zustand = 'kommend';
  if (iso < heute) zustand = 'vergangen';
  else if (iso === heute) zustand = 'heute';

  const abschnitte = fenster.filter((seg) => abschnittAmTag(seg, start, ende));
  const titel = tagTitel(istSeetag, abschnitte, trip, mittag);
  const zeilen = tagZeilen(abschnitte, start, ende, zone, istSeetag);

  return { iso, wochentag, datum, titel, zeilen, zustand, seetag: istSeetag };
}

function abschnittAmTag(seg, start, ende) {
  const von = seg.fensterStart;
  if (!von) return false;
  const bis = seg.fensterEnde;
  if (bis && bis <= start) return false;
  if (von >= ende) return false;
  return true;
}

function tagTitel(istSeetag, abschnitte, trip, mittag) {
  if (istSeetag) return 'Seetag 🌊';

  // Nachmittag zählt stärker als ein kurzer Hotel-Check-out am Morgen.
  const nachmittag = new Date(mittag.getTime() + 3 * 60 * 60 * 1000);
  const spaetTitel = titelAusStatus(getStatus(trip, nachmittag));
  if (spaetTitel) return spaetTitel;

  const mittagTitel = titelAusStatus(getStatus(trip, mittag));
  if (mittagTitel) return mittagTitel;

  let bester = null;
  let besteDauer = -1;
  const tagStart = mittag.getTime() - 12 * 60 * 60 * 1000;
  const tagEnde = mittag.getTime() + 12 * 60 * 60 * 1000;
  for (const seg of abschnitte) {
    if (seg.typ !== 'ort') continue;
    const von = Math.max(seg.fensterStart?.getTime() || tagStart, tagStart);
    const bis = Math.min(seg.fensterEnde?.getTime() || tagEnde, tagEnde);
    const dauer = Math.max(0, bis - von);
    const prio = { hotel: 5, hafen: 4, zuhause: 3, bahnhof: 1 }[seg.eintrag.art] || 2;
    const score = dauer + prio * 2 * 3600000;
    if (score > besteDauer) {
      besteDauer = score;
      bester = seg.eintrag.name;
    }
  }
  if (bester) return bester;
  const fahrt = abschnitte.find((seg) => seg.typ === 'fahrt');
  if (fahrt?.nachOrt?.name) return `Unterwegs nach ${fahrt.nachOrt.name}`;
  if (fahrt?.eintrag?.name) return fahrt.eintrag.name;
  return 'Reisetag';
}

function titelAusStatus(status) {
  if (status?.status === 'ort' && status.name) return status.name;
  if (status?.status === 'fahrt') {
    if (status.modus === 'schiff') return 'Seetag 🌊';
    if (status.nach?.name) return `Unterwegs nach ${status.nach.name}`;
    return status.name || 'Unterwegs';
  }
  return null;
}

function tagZeilen(abschnitte, start, ende, zone, istSeetag) {
  const zeilen = [];
  const gesehen = new Set();
  for (const seg of abschnitte) {
    if (seg.typ === 'ort') {
      const ort = seg.eintrag;
      const uhr = uhrenAmTag(seg.originalStart, seg.originalEnde, start, ende, zone);
      if (uhr) zeilen.push({ uhr, text: ort.name || 'Ort' });
      else zeilen.push({ uhr: '', text: ort.name || 'Ort' });
      if (ort.info && !gesehen.has(ort.info)) {
        gesehen.add(ort.info);
        zeilen.push({ uhr: '', text: ort.info });
      }
    } else {
      const fahrt = seg.eintrag;
      const name = fahrtName(fahrt);
      const uhr = uhrenAmTag(seg.originalStart, seg.originalEnde, start, ende, zone);
      zeilen.push({ uhr, text: name });
      if (fahrt.info && !gesehen.has(fahrt.info)) {
        gesehen.add(fahrt.info);
        zeilen.push({ uhr: '', text: fahrt.info });
      } else if (istSeetag && fahrt.modus === 'schiff' && !fahrt.info) {
        const text = 'Auf See';
        if (!gesehen.has(text)) {
          gesehen.add(text);
          zeilen.push({ uhr: '', text });
        }
      }
    }
  }
  return zeilen;
}

function fahrtName(fahrt) {
  if (fahrt.modus === 'schiff') return fahrt.name ? `Schiff: ${fahrt.name}` : 'Schiff';
  if (fahrt.modus === 'zug') return fahrt.name || 'Zug';
  if (fahrt.modus === 'sbahn') return fahrt.name || 'S-Bahn';
  if (fahrt.modus === 'taxi') return fahrt.name || 'Taxi';
  return fahrt.name || 'Fahrt';
}

function uhrenAmTag(von, bis, start, ende, zone) {
  const teile = [];
  if (von && von >= start && von < ende) teile.push(uhrKurz(von, zone).replace(' Uhr', ''));
  if (bis && bis > start && bis <= ende) teile.push(uhrKurz(bis, zone).replace(' Uhr', ''));
  // Ganz im Tag liegende Spanne: von–bis; nur Start oder nur Ende sonst.
  if (teile.length === 2) return `${teile[0]}–${teile[1]}`;
  if (teile.length === 1) return teile[0];
  if (von && bis && von < start && bis > ende) return 'ganzer Tag';
  return '';
}

function countdownZeile(status) {
  if (status?.restMs == null) return '🧳 Die Reise hat noch nicht begonnen.';
  const volleTage = Math.floor(status.restMs / 86400000);
  if (volleTage >= 2) return `🧳 Noch ${volleTage} Tage bis zur Abfahrt!`;
  if (volleTage === 1) return '🧳 Noch 1 Tag bis zur Abfahrt!';
  const stunden = Math.max(1, Math.round(status.restMs / 3600000));
  const wort = stunden === 1 ? 'Stunde' : 'Stunden';
  return `🧳 Noch ${stunden} ${wort} bis zur Abfahrt!`;
}

function ortZeile(status, zeit, zone) {
  const uhr = status.bis ? uhrKurz(status.bis, zone) : null;
  const heute = status.bis && tagIso(zeit, zone) === tagIso(status.bis, zone);
  if (status.ortArt === 'hotel') {
    const name = String(status.name || '').replace(/^Hotel\s+/i, '');
    return `🛏️ Im Hotel ${name}`;
  }
  if (status.ortArt === 'hafen') {
    if (uhr && heute) return `⚓ In ${status.name} – Abfahrt heute ${uhr}`;
    if (uhr) return `⚓ In ${status.name} – Abfahrt ${uhr}`;
    return `⚓ In ${status.name}`;
  }
  if (status.ortArt === 'bahnhof') {
    if (uhr && heute) return `🚉 ${status.name} – Weiterfahrt ${uhr}`;
    if (uhr) return `🚉 ${status.name}`;
    return `🚉 ${status.name}`;
  }
  if (status.ortArt === 'zuhause') {
    if (uhr && heute) return `🏠 ${status.name} – Abfahrt heute ${uhr}`;
    if (uhr) return `🏠 ${status.name}`;
    return `🏠 ${status.name}`;
  }
  return `📍 ${status.name}`;
}

function fahrtZeile(status, zone) {
  const ankunft = status.an ? uhrKurz(status.an, zone) : null;
  if (status.modus === 'schiff') {
    let zeile = '🌊 Auf See';
    if (status.nach?.name) zeile += ` – unterwegs nach ${status.nach.name}`;
    if (status.restMs > 0) zeile += `, ${restKurz(status.restMs)}`;
    return zeile;
  }
  if (status.modus === 'zug') {
    const erstes = String(status.name || '').split(' ')[0];
    const mitIm = erstes && !/^(nach|mit|zum|zur|heim|in|von)$/i.test(erstes);
    const kern = mitIm ? `Im ${status.name}` : status.name;
    return ankunft ? `🚂 ${kern} – Ankunft ${ankunft}` : `🚂 ${kern}`;
  }
  if (status.modus === 'sbahn') {
    return ankunft ? `🚈 ${status.name} – Ankunft ${ankunft}` : `🚈 ${status.name}`;
  }
  if (status.modus === 'taxi') {
    return ankunft ? `🚕 ${status.name} – Ankunft ${ankunft}` : `🚕 ${status.name}`;
  }
  return status.name || 'Unterwegs';
}

function restKurz(ms) {
  const minuten = Math.max(1, Math.round(ms / 60000));
  if (minuten < 60) return `noch ca. ${minuten} Min.`;
  const stunden = Math.max(1, Math.round(ms / 3600000));
  return `noch ca. ${stunden} Std.`;
}

function uhrKurz(date, zone) {
  const text = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${text} Uhr`;
}

function tageZwischen(vonIso, bisIso) {
  const [vj, vm, vt] = String(vonIso).split('-').map(Number);
  const [bj, bm, bt] = String(bisIso).split('-').map(Number);
  const von = Date.UTC(vj, vm - 1, vt);
  const bis = Date.UTC(bj, bm - 1, bt);
  return Math.round((bis - von) / 86400000);
}

/**
 * ?zeit=2026-11-08T14:00 überschreibt die Uhr.
 * Ohne Zeitzone in der Angabe gilt die Ortszeit des Geräts.
 */
export function zeitAusAdresse(suche, jetzt = new Date()) {
  const params = new URLSearchParams(suche);
  const roh = params.get('zeit');
  if (!roh) return { zeit: jetzt, test: false };
  const zeit = new Date(roh);
  if (Number.isNaN(zeit.getTime())) return { zeit: jetzt, test: false };
  return { zeit, test: true };
}

/** Lange deutsche Uhrzeit, für den gelben Testzeit-Hinweis. */
export function uhrzeitLang(date, zone) {
  const text = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${text} Uhr`;
}

function ortStatus(seg, plan) {
  const ort = seg.eintrag;
  return {
    status: 'ort',
    name: ort.name || '',
    ortArt: ort.art || '',
    land: ort.land || '',
    info: ort.info || null,
    lat: ort.lat,
    lon: ort.lon,
    seit: seg.originalStart,
    bis: seg.originalEnde,
    danach: danachInfo(plan, seg.index),
  };
}

function fahrtStatus(seg, zeit, seetag) {
  const fahrt = seg.eintrag;
  const start = seg.originalStart;
  const ende = seg.originalEnde;
  const dauer = start && ende ? ende.getTime() - start.getTime() : 0;
  let fortschritt = 1;
  if (dauer > 0) {
    fortschritt = (zeit.getTime() - start.getTime()) / dauer;
    if (fortschritt < 0) fortschritt = 0;
    if (fortschritt > 1) fortschritt = 1;
  }
  const punkte = routenpunkte(seg);
  const lage = positionAufLinie(punkte, fortschritt);
  const restMs = ende ? Math.max(0, ende.getTime() - zeit.getTime()) : 0;
  return {
    status: 'fahrt',
    modus: fahrt.modus,
    name: fahrt.name || '',
    info: fahrt.info || null,
    von: ortKurz(seg.vonOrt),
    nach: ortKurz(seg.nachOrt),
    ab: start,
    an: ende,
    fortschritt,
    restMs,
    position: lage ? { lat: lage.lat, lon: lage.lon } : null,
    richtung: lage ? lage.richtung : 'rechts',
    seetag,
  };
}

function danachInfo(plan, index) {
  const naechstes = plan[index + 1];
  if (!naechstes) return null;
  if (naechstes.typ === 'fahrt') {
    const ziel = plan[index + 2];
    return {
      typ: 'fahrt',
      modus: naechstes.modus,
      name: naechstes.name || '',
      ziel: ziel && ziel.typ === 'ort' ? ziel.name : null,
    };
  }
  return { typ: naechstes.typ, name: naechstes.name || '' };
}

function ortKurz(ort) {
  if (!ort) return null;
  return {
    name: ort.name || '',
    art: ort.art || '',
    lat: ort.lat,
    lon: ort.lon,
  };
}

function zeitfenster(plan, zone) {
  const segs = plan.map((eintrag, index) => ({
    typ: eintrag.typ,
    eintrag,
    index,
    originalStart: alsDatum(eintrag.typ === 'fahrt' ? eintrag.ab : eintrag.von),
    originalEnde: alsDatum(eintrag.typ === 'fahrt' ? eintrag.an : eintrag.bis),
    vonOrt: eintrag.typ === 'fahrt' && plan[index - 1]?.typ === 'ort' ? plan[index - 1] : null,
    nachOrt: eintrag.typ === 'fahrt' && plan[index + 1]?.typ === 'ort' ? plan[index + 1] : null,
  }));

  const erster = ersterZeitstempel(plan);
  const tagBeginn = erster ? mitternachtVonDatum(erster, zone) : null;
  let cursor = tagBeginn;

  return segs.map((seg, i) => {
    const start = seg.originalStart ?? (i === 0 ? tagBeginn : cursor);
    const naechstes = segs[i + 1];
    let ende = seg.originalEnde;
    // Kleine Lücken bleiben beim vorherigen Abschnitt, damit die Uhr nie ins Leere fällt.
    if (ende && naechstes?.originalStart && naechstes.originalStart > ende) {
      ende = naechstes.originalStart;
    }
    if (!ende && naechstes) ende = naechstes.originalStart ?? null;
    if (ende) cursor = ende;
    else if (start) cursor = start;
    return { ...seg, fensterStart: start, fensterEnde: ende };
  });
}

function ersterZeitstempel(plan) {
  let min = null;
  for (const eintrag of plan) {
    for (const feld of ['von', 'bis', 'ab', 'an']) {
      const datum = alsDatum(eintrag[feld]);
      if (datum && (!min || datum < min)) min = datum;
    }
  }
  return min;
}

function routenpunkte(seg) {
  const punkte = [];
  if (seg.vonOrt && Number.isFinite(seg.vonOrt.lat) && Number.isFinite(seg.vonOrt.lon)) {
    punkte.push({ lat: seg.vonOrt.lat, lon: seg.vonOrt.lon });
  }
  for (const weg of seg.eintrag.wegpunkte || []) {
    if (Array.isArray(weg) && weg.length >= 2 && Number.isFinite(weg[0]) && Number.isFinite(weg[1])) {
      punkte.push({ lat: weg[0], lon: weg[1] });
    }
  }
  if (seg.nachOrt && Number.isFinite(seg.nachOrt.lat) && Number.isFinite(seg.nachOrt.lon)) {
    punkte.push({ lat: seg.nachOrt.lat, lon: seg.nachOrt.lon });
  }
  return punkte;
}

/** Zeitanteil 0..1 wird zur Strecke: gleich viel Zeit heißt gleich viel Weg. */
function positionAufLinie(punkte, anteil) {
  if (punkte.length === 0) return null;
  if (punkte.length === 1 || anteil <= 0) {
    return { lat: punkte[0].lat, lon: punkte[0].lon, richtung: richtungVoraus(punkte, 0) };
  }
  const strecken = [];
  let gesamt = 0;
  for (let i = 0; i < punkte.length - 1; i += 1) {
    const laenge = distanzMeter(punkte[i], punkte[i + 1]);
    strecken.push(laenge);
    gesamt += laenge;
  }
  if (gesamt === 0 || anteil >= 1) {
    return {
      lat: punkte[punkte.length - 1].lat,
      lon: punkte[punkte.length - 1].lon,
      richtung: richtungVoraus(punkte, Math.max(0, punkte.length - 2)),
    };
  }
  let rest = anteil * gesamt;
  for (let i = 0; i < strecken.length; i += 1) {
    const laenge = strecken[i];
    if (rest < laenge || i === strecken.length - 1) {
      const t = laenge === 0 ? 0 : Math.min(1, rest / laenge);
      const a = punkte[i];
      const b = punkte[i + 1];
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        richtung: richtungVoraus(punkte, i),
      };
    }
    rest -= laenge;
  }
  return null;
}

/** Ostwärts schaut das Fahrzeug nach rechts, westwärts nach links. */
function richtungVoraus(punkte, index) {
  for (let i = index; i < punkte.length - 1; i += 1) {
    const delta = punkte[i + 1].lon - punkte[i].lon;
    if (delta > 0) return 'rechts';
    if (delta < 0) return 'links';
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const delta = punkte[i + 1].lon - punkte[i].lon;
    if (delta > 0) return 'rechts';
    if (delta < 0) return 'links';
  }
  return 'rechts';
}

function distanzMeter(a, b) {
  const erde = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * erde * Math.asin(Math.min(1, Math.sqrt(h)));
}

function alsDatum(wert) {
  if (wert instanceof Date) return Number.isNaN(wert.getTime()) ? null : wert;
  if (!wert) return null;
  const datum = new Date(wert);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

function lokalesDatum(zeitpunkt) {
  const zeit = alsDatum(zeitpunkt) ?? new Date(zeitpunkt);
  const monat = String(zeit.getMonth() + 1).padStart(2, '0');
  const tag = String(zeit.getDate()).padStart(2, '0');
  return `${zeit.getFullYear()}-${monat}-${tag}`;
}

function teileInZone(date, zone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const werte = {};
  for (const teil of fmt.formatToParts(date)) {
    if (teil.type !== 'literal') werte[teil.type] = teil.value;
  }
  if (werte.hour === '24') werte.hour = '00';
  return {
    jahr: Number(werte.year),
    monat: Number(werte.month),
    tag: Number(werte.day),
    stunde: Number(werte.hour),
    minute: Number(werte.minute),
    sekunde: Number(werte.second),
  };
}

function offsetMs(date, zone) {
  const teile = teileInZone(date, zone);
  const alsUtc = Date.UTC(teile.jahr, teile.monat - 1, teile.tag, teile.stunde, teile.minute, teile.sekunde);
  return alsUtc - date.getTime();
}

function mitternacht(jahr, monat, tag, zone) {
  let utc = Date.UTC(jahr, monat - 1, tag, 0, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const korrektur = Date.UTC(jahr, monat - 1, tag, 0, 0, 0) - offsetMs(new Date(utc), zone);
    if (korrektur === utc) break;
    utc = korrektur;
  }
  return new Date(utc);
}

function mitternachtVonDatum(date, zone) {
  const teile = teileInZone(date, zone);
  return mitternacht(teile.jahr, teile.monat, teile.tag, zone);
}

function mitternachtVonIso(iso, zone) {
  const [jahr, monat, tag] = iso.split('-').map(Number);
  return mitternacht(jahr, monat, tag, zone);
}

function tagIso(date, zone) {
  const teile = teileInZone(date, zone);
  const monat = String(teile.monat).padStart(2, '0');
  const tag = String(teile.tag).padStart(2, '0');
  return `${teile.jahr}-${monat}-${tag}`;
}

function naechsterKalendertag(iso, zone) {
  const start = mitternachtVonIso(iso, zone);
  // 36 Stunden später liegt auch bei Zeitumstellung im nächsten Kalendertag.
  const spaeter = tagIso(new Date(start.getTime() + 36 * 60 * 60 * 1000), zone);
  return { iso: spaeter, start: mitternachtVonIso(spaeter, zone) };
}

function seetageSatz(trip) {
  const zone = trip?.zeitzone || 'Europe/Berlin';
  const tage = seetage(trip);
  if (tage.length === 0) return null;
  const namen = tage.map((iso) => tagSprechen(iso, zone));
  return `Seetage: ${undListe(namen)}.`;
}

function tagSprechen(iso, zone) {
  const mittag = new Date(mitternachtVonIso(iso, zone).getTime() + 12 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(mittag);
}

function zeitText(date, zone) {
  const text = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${text} Uhr`;
}

function dauerTeile(ms) {
  const gesamtMinuten = Math.max(0, Math.round(ms / 60000));
  const tage = Math.floor(gesamtMinuten / (60 * 24));
  const stunden = Math.floor((gesamtMinuten % (60 * 24)) / 60);
  const minuten = gesamtMinuten % 60;
  const teile = [];
  if (tage > 0) teile.push(tage === 1 ? '1 Tag' : `${tage} Tage`);
  if (stunden > 0) teile.push(stunden === 1 ? '1 Stunde' : `${stunden} Stunden`);
  if (minuten > 0 || teile.length === 0) teile.push(minuten === 1 ? '1 Minute' : `${minuten} Minuten`);
  return teile;
}

function undListe(teile) {
  if (teile.length === 0) return '';
  if (teile.length === 1) return teile[0];
  return `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}

function mitModus(modus) {
  const name = MODUS_NAME[modus];
  if (modus === 'sbahn') return 'der S-Bahn';
  if (name) return `dem ${name}`;
  return 'dem Fahrzeug';
}

function prozentText(anteil) {
  return new Intl.NumberFormat('de-DE', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(anteil || 0);
}

function koordinatenText(lat, lon) {
  const zahl = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const ns = lat >= 0 ? 'N' : 'S';
  const ow = lon >= 0 ? 'O' : 'W';
  return `${zahl.format(Math.abs(lat))}° ${ns}, ${zahl.format(Math.abs(lon))}° ${ow}`;
}
