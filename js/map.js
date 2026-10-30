/**
 * Comic-Karte. Weltumriss von world-atlas, gezeichnet mit d3-geo.
 * Bibliotheken nur von cdn.jsdelivr.net, festgenagelte Versionen.
 * Die Position kommt aus dem Reiseplan, nicht aus dem Netz.
 */

import { geoMercator, geoPath } from 'https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm';
import { select } from 'https://cdn.jsdelivr.net/npm/d3-selection@3.0.0/+esm';
import { zoom, zoomIdentity } from 'https://cdn.jsdelivr.net/npm/d3-zoom@3.0.0/+esm';
import { feature } from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
import { fahrtPunkte, streckeTeilen } from './trip.js';

const ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';

let atlasVersprechen = null;

function atlasLaden() {
  if (!atlasVersprechen) {
    atlasVersprechen = fetch(ATLAS_URL).then((antwort) => {
      if (!antwort.ok) throw new Error('atlas');
      return antwort.json();
    }).catch((fehler) => {
      atlasVersprechen = null;
      throw fehler;
    });
  }
  return atlasVersprechen;
}

/**
 * Baut die Karte einmal. aktualisieren setzt Fahrzeug, Route und Nacht
 * neu, ohne die Welt neu zu laden und ohne den Zoom zu verwerfen.
 */
export async function karteErstellen(container) {
  const topo = await atlasLaden();
  const laender = feature(topo, topo.objects.countries);

  container.replaceChildren();
  const svg = select(container).append('svg')
    .attr('class', 'reise-karte')
    .attr('role', 'img')
    .attr('aria-label', 'Gezeichnete Karte der Reise');

  const defs = svg.append('defs');
  const muster = defs.append('pattern')
    .attr('id', 'rt-wellen')
    .attr('width', 84)
    .attr('height', 52)
    .attr('patternUnits', 'userSpaceOnUse');
  muster.append('path')
    .attr('class', 'welle')
    .attr('d', 'M2 28 q10 -12 20 0 t20 0 t20 0');
  muster.append('circle').attr('class', 'welle').attr('cx', 62).attr('cy', 14).attr('r', 7);
  muster.append('circle').attr('class', 'welle').attr('cx', 62).attr('cy', 14).attr('r', 3);

  const zoomGruppe = svg.append('g').attr('class', 'zoom-gruppe');
  const meer = zoomGruppe.append('rect').attr('class', 'meer');
  const wellen = zoomGruppe.append('rect')
    .attr('class', 'wellen-schleier')
    .attr('fill', 'url(#rt-wellen)');
  const landGruppe = zoomGruppe.append('g').attr('class', 'laender');
  const routenGruppe = zoomGruppe.append('g').attr('class', 'routen');
  const nadelGruppe = zoomGruppe.append('g').attr('class', 'nadeln');
  const fahrzeugGruppe = zoomGruppe.append('g').attr('class', 'fahrzeuge');

  const himmel = svg.append('g').attr('class', 'nacht-deko');
  himmelZeichnen(himmel);
  moeweZeichnen(svg.append('g').attr('class', 'moewe moewe-1'));
  moeweZeichnen(svg.append('g').attr('class', 'moewe moewe-2'));

  const projektion = geoMercator();
  const pfad = geoPath(projektion);
  const landPfade = landGruppe.selectAll('path')
    .data(laender.features)
    .join('path')
    .attr('class', (land) => (Number(land.id) % 2 === 0 ? 'land land-sand' : 'land land-gruen'));

  let breite = 360;
  let hoehe = 460;
  let trip = null;
  let tripId = null;
  let status = null;
  let zeit = new Date();
  let transform = zoomIdentity;
  let animationsRahmen = 0;
  let angepasst = false;
  let ortKlick = null;
  const marken = [];

  const verhalten = zoom()
    .scaleExtent([1, 14])
    .on('zoom', (ereignis) => {
      transform = ereignis.transform;
      zoomGruppe.attr('transform', transform);
      markenSkalieren();
    });

  svg.call(verhalten);

  function groesseLesen() {
    const gemessen = Math.round(container.clientWidth);
    const naechsteBreite = Math.max(280, gemessen || breite);
    const naechsteHoehe = Math.max(340, Math.round(Math.min(naechsteBreite * 1.22, window.innerHeight * 0.62)));
    return { breite: naechsteBreite, hoehe: naechsteHoehe };
  }

  function flaecheDerReise() {
    const koordinaten = [];
    for (const eintrag of trip?.plan || []) {
      if (eintrag.typ === 'ort' && Number.isFinite(eintrag.lon) && Number.isFinite(eintrag.lat)) {
        koordinaten.push([eintrag.lon, eintrag.lat]);
      }
      for (const weg of eintrag.wegpunkte || []) {
        if (Array.isArray(weg) && weg.length >= 2) koordinaten.push([weg[1], weg[0]]);
      }
    }
    if (koordinaten.length === 0) koordinaten.push([10, 51], [12, 48]);
    return {
      type: 'Feature',
      geometry: { type: 'MultiPoint', coordinates: koordinaten },
    };
  }

  function projektionAnpassen() {
    svg.attr('width', breite).attr('height', hoehe).attr('viewBox', `0 0 ${breite} ${hoehe}`);
    meer.attr('x', -breite * 2).attr('y', -hoehe * 2).attr('width', breite * 5).attr('height', hoehe * 5);
    wellen.attr('x', -breite * 2).attr('y', -hoehe * 2).attr('width', breite * 5).attr('height', hoehe * 5);
    projektion.fitExtent([[28, 28], [breite - 28, hoehe - 128]], flaecheDerReise());
    landPfade.attr('d', pfad);
    verhalten.extent([[0, 0], [breite, hoehe]]);
    verhalten.translateExtent([[-40, -40], [breite + 40, hoehe + 40]]);
  }

  function markenSkalieren() {
    const k = transform.k || 1;
    for (const marke of marken) {
      const schub = marke.versatz ? `translate(${marke.versatz},0) ` : '';
      marke.innen.attr('transform', `${schub}scale(${1 / k})`);
    }
  }

  function marke(gruppe, x, y, versatz = 0, klasse = '') {
    const aussen = gruppe.append('g').attr('transform', `translate(${x},${y})`);
    const innen = aussen.append('g');
    if (klasse) innen.attr('class', klasse);
    marken.push({ innen, versatz });
    return innen;
  }

  function schilderOrdnen() {
    const eintraege = [...container.querySelectorAll('.nadel-innen')].map((g) => ({
      schild: g.querySelector('.nadel-schild'),
      name: g.querySelector('.nadel-name'),
    })).filter((eintrag) => eintrag.schild && eintrag.name);
    const knoepfe = container.parentElement?.querySelector('.karten-knopfleiste')?.getBoundingClientRect();
    const k = transform.k || 1;
    const kasten = (eintrag) => eintrag.schild.getBoundingClientRect();
    const schiebe = (eintrag, dyScreen) => {
      const dy = dyScreen * k;
      eintrag.name.setAttribute('y', Number(eintrag.name.getAttribute('y')) + dy);
      eintrag.schild.setAttribute('y', Number(eintrag.schild.getAttribute('y')) + dy);
    };
    const nachOben = (eintrag) => {
      eintrag.name.setAttribute('y', -46);
      const box = eintrag.name.getBBox();
      eintrag.schild.setAttribute('x', box.x - 6);
      eintrag.schild.setAttribute('y', box.y - 3);
      eintrag.schild.setAttribute('width', box.width + 12);
      eintrag.schild.setAttribute('height', box.height + 6);
    };
    const trifft = (a, b) => !(a.right < b.left + 2 || a.left > b.right - 2 || a.bottom < b.top + 2 || a.top > b.bottom - 2);

    for (const eintrag of eintraege) {
      if (knoepfe && kasten(eintrag).bottom > knoepfe.top - 6) nachOben(eintrag);
    }
    eintraege.sort((a, b) => kasten(a).top - kasten(b).top);
    for (let i = 0; i < eintraege.length; i += 1) {
      for (let runde = 0; runde < 8; runde += 1) {
        const rect = kasten(eintraege[i]);
        let blocker = null;
        for (let j = 0; j < i; j += 1) {
          const andere = kasten(eintraege[j]);
          if (trifft(rect, andere)) {
            blocker = andere;
            break;
          }
        }
        if (!blocker) break;
        schiebe(eintraege[i], blocker.bottom - rect.top + 4);
        if (knoepfe && kasten(eintraege[i]).bottom > knoepfe.top - 6) nachOben(eintraege[i]);
      }
    }
  }

  function xy(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const pos = projektion([lon, lat]);
    if (!pos || Number.isNaN(pos[0]) || Number.isNaN(pos[1])) return null;
    return { x: pos[0], y: pos[1] };
  }

  function routenZeichnen() {
    routenGruppe.selectAll('*').remove();
    const plan = trip?.plan || [];
    for (let i = 0; i < plan.length; i += 1) {
      const eintrag = plan[i];
      if (eintrag.typ !== 'fahrt') continue;
      const davor = plan[i - 1]?.typ === 'ort' ? plan[i - 1] : null;
      const danach = plan[i + 1]?.typ === 'ort' ? plan[i + 1] : null;
      const punkte = fahrtPunkte(davor, eintrag, danach);
      const anteil = anteilDerFahrt(eintrag, zeit, status);
      const teile = streckeTeilen(punkte, anteil);
      const klasse = routenKlasse(eintrag.modus);
      linie(teile.gefahren, `${klasse} route-gefahren`);
      linie(teile.kommend, `${klasse} route-kommend`);
    }
  }

  function linie(punkte, klasse) {
    if (!punkte || punkte.length < 2) return;
    const d = pfad({
      type: 'LineString',
      coordinates: punkte.map((punkt) => [punkt.lon, punkt.lat]),
    });
    if (!d) return;
    routenGruppe.append('path').attr('class', klasse).attr('d', d);
  }

  function nadelnZeichnen() {
    nadelGruppe.selectAll('*').remove();
    const plan = trip?.plan || [];
    const hier = zielPunkt();
    const orte = new Map();
    for (const eintrag of plan) {
      if (eintrag.typ !== 'ort') continue;
      const schluessel = `${eintrag.name}|${Number(eintrag.lat).toFixed(2)},${Number(eintrag.lon).toFixed(2)}`;
      const besucht = ortBesucht(eintrag, zeit);
      const aktuell = Boolean(hier
        && Math.abs(eintrag.lat - hier.lat) < 0.02
        && Math.abs(eintrag.lon - hier.lon) < 0.02
        && !besucht);
      const bisher = orte.get(schluessel);
      if (!bisher) {
        orte.set(schluessel, { eintrag, besucht: besucht && !aktuell, aktuell });
      } else {
        if (aktuell) {
          bisher.aktuell = true;
          bisher.besucht = false;
          bisher.eintrag = eintrag;
        } else if (besucht && !bisher.aktuell) {
          bisher.besucht = true;
        } else if (!bisher.aktuell && !besucht && ortBesucht(bisher.eintrag, zeit)) {
          // Kommender Besuch ersetzt einen schon vergangenen Eintrag derselben Nadel.
          bisher.eintrag = eintrag;
          bisher.besucht = false;
        }
      }
    }
    for (const { eintrag, besucht, aktuell } of orte.values()) {
      const pos = xy(eintrag.lat, eintrag.lon);
      if (!pos) continue;
      const innen = marke(nadelGruppe, pos.x, pos.y, 0, 'nadel-innen');
      nadelSymbol(innen, eintrag, besucht, aktuell);
      innen.style('cursor', 'pointer')
        .attr('role', 'button')
        .attr('tabindex', 0)
        .on('click', (ereignis) => {
          ereignis.sourceEvent?.stopPropagation();
          ortKlick?.(eintrag);
        });
    }
  }

  function fahrzeugZeichnen() {
    fahrzeugGruppe.selectAll('*').remove();
    const hier = zielPunkt();
    if (!hier) return;
    const pos = xy(hier.lat, hier.lon);
    if (!pos) return;
    const innen = marke(fahrzeugGruppe, pos.x, pos.y);
    const art = fahrzeugArt();
    const richtung = fahrzeugRichtung();
    const flip = innen.append('g');
    if (richtung === 'links') flip.attr('transform', 'scale(-1,1)');
    if (art === 'schiff' || art === 'schiff-hafen') schiffZeichnen(flip, art === 'schiff');
    else if (art === 'zug') zugZeichnen(flip, innen);
    else if (art === 'sbahn') sbahnZeichnen(flip);
    else if (art === 'taxi') taxiZeichnen(flip);
    else leuteZeichnen(innen, schlaeft());
  }

  function zielPunkt() {
    if (status?.status === 'fahrt' && status.position) return status.position;
    if (Number.isFinite(status?.lat) && Number.isFinite(status?.lon)) {
      return { lat: status.lat, lon: status.lon };
    }
    const orte = (trip?.plan || []).filter((eintrag) => eintrag.typ === 'ort' && Number.isFinite(eintrag.lat));
    if (status?.status === 'nachReise') return orte[orte.length - 1] || null;
    return orte[0] || null;
  }

  function fahrzeugArt() {
    if (status?.status === 'fahrt') return status.modus || 'zug';
    if (status?.status === 'ort' && status.ortArt === 'hafen') return 'schiff-hafen';
    if (status?.status === 'vorReise' || status?.status === 'nachReise' || status?.status === 'ort') return 'leute';
    return 'leute';
  }

  function schlaeft() {
    return Boolean(svg.classed('nacht') && status?.status === 'ort' && status.ortArt === 'hotel');
  }

  function fahrzeugRichtung() {
    if (status?.status === 'fahrt' && status.richtung) return status.richtung;
    const plan = trip?.plan || [];
    const hier = zielPunkt();
    if (!hier) return 'rechts';
    const index = plan.findIndex((eintrag) => eintrag.typ === 'ort'
      && Number.isFinite(eintrag.lat)
      && Math.abs(eintrag.lat - hier.lat) < 0.02
      && Math.abs(eintrag.lon - hier.lon) < 0.02
      && !ortBesucht(eintrag, zeit));
    const ort = plan[index];
    const naechste = plan[index + 1];
    if (ort && naechste?.typ === 'fahrt') {
      const ziel = plan[index + 2]?.typ === 'ort' ? plan[index + 2] : null;
      const punkte = fahrtPunkte(ort, naechste, ziel);
      if (punkte.length >= 2) return punkte[1].lon >= punkte[0].lon ? 'rechts' : 'links';
    }
    return 'rechts';
  }

  function szeneNeu() {
    marken.length = 0;
    routenZeichnen();
    nadelnZeichnen();
    fahrzeugZeichnen();
    markenSkalieren();
    schilderOrdnen();
  }

  function anpassenUndZurueck() {
    const masse = groesseLesen();
    breite = masse.breite;
    hoehe = masse.hoehe;
    projektionAnpassen();
    transform = zoomIdentity;
    svg.call(verhalten.transform, zoomIdentity);
    szeneNeu();
  }

  const beobachter = new ResizeObserver(() => {
    if (!angepasst) return;
    const masse = groesseLesen();
    if (Math.abs(masse.breite - breite) < 8 && Math.abs(masse.hoehe - hoehe) < 8) return;
    anpassenUndZurueck();
  });
  beobachter.observe(container);

  function aktualisieren(neuesTrip, neuerStatus, neueZeit) {
    const neueId = neuesTrip?.id || null;
    const gewechselt = angepasst && neueId !== tripId;
    trip = neuesTrip;
    tripId = neueId;
    status = neuerStatus;
    zeit = neueZeit instanceof Date ? neueZeit : new Date(neueZeit);
    svg.classed('nacht', istNachtLokal(zeit, trip?.zeitzone || 'Europe/Berlin'));
    if (!angepasst || gewechselt) {
      anpassenUndZurueck();
      angepasst = true;
    } else szeneNeu();
  }

  function setzeOrtKlick(fn) {
    ortKlick = typeof fn === 'function' ? fn : null;
  }

  function sanft(ziel) {
    const start = transform;
    const beginn = performance.now();
    const dauer = 750;
    cancelAnimationFrame(animationsRahmen);
    const schritt = (jetzt) => {
      const p = Math.min(1, (jetzt - beginn) / dauer);
      const e = 1 - (1 - p) ** 3;
      const k = start.k + (ziel.k - start.k) * e;
      const x = start.x + (ziel.x - start.x) * e;
      const y = start.y + (ziel.y - start.y) * e;
      svg.call(verhalten.transform, zoomIdentity.translate(x, y).scale(k));
      if (p < 1) animationsRahmen = requestAnimationFrame(schritt);
    };
    animationsRahmen = requestAnimationFrame(schritt);
  }

  function ganzeReise() {
    sanft(zoomIdentity);
  }

  function woSindWir() {
    const hier = zielPunkt();
    const pos = hier ? xy(hier.lat, hier.lon) : null;
    if (!pos) return;
    const k = 5;
    sanft(zoomIdentity.translate(breite / 2 - pos.x * k, hoehe / 2 - 30 - pos.y * k).scale(k));
  }

  function zerstoeren() {
    cancelAnimationFrame(animationsRahmen);
    beobachter.disconnect();
    container.replaceChildren();
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (container.isConnected && trip) szeneNeu();
    });
  }

  return { aktualisieren, ganzeReise, woSindWir, setzeOrtKlick, zerstoeren };
}

function istNachtLokal(zeit, zone) {
  try {
    const stunde = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(zeit).find((teil) => teil.type === 'hour');
    const wert = Number(stunde?.value === '24' ? '0' : stunde?.value);
    return wert >= 21 || wert < 6;
  } catch {
    return false;
  }
}

function anteilDerFahrt(fahrt, zeit, status) {
  const ab = new Date(fahrt.ab).getTime();
  const an = new Date(fahrt.an).getTime();
  const t = zeit.getTime();
  if (Number.isNaN(ab) || Number.isNaN(an)) return 0;
  if (t >= an) return 1;
  if (t <= ab) return 0;
  if (status?.status === 'fahrt' && status.ab instanceof Date && status.ab.getTime() === ab) {
    return status.fortschritt ?? 0;
  }
  const dauer = an - ab;
  return dauer <= 0 ? 1 : (t - ab) / dauer;
}

function ortBesucht(ort, zeit) {
  if (!ort.bis) return false;
  const bis = new Date(ort.bis).getTime();
  return !Number.isNaN(bis) && zeit.getTime() >= bis;
}

function routenKlasse(modus) {
  if (modus === 'schiff') return 'route route-schiff';
  if (modus === 'zug') return 'route route-zug';
  return 'route route-grau';
}

function nadelSymbol(innen, ort, besucht, aktuell) {
  if (aktuell) {
    innen.append('circle').attr('class', 'nadel-ring').attr('r', 26);
  }
  innen.append('circle').attr('class', 'nadel-kopf').attr('r', 18);
  const symbol = innen.append('g').attr('class', 'nadel-symbol');
  if (ort.art === 'hotel') bettZeichnen(symbol);
  else if (ort.art === 'hafen') ankerZeichnen(symbol.append('g').attr('transform', 'scale(0.55)'));
  else if (ort.art === 'bahnhof') miniZugZeichnen(symbol);
  else hausZeichnen(symbol);
  if (besucht) {
    const haken = innen.append('g').attr('transform', 'translate(12,-14)');
    haken.append('circle').attr('class', 'haken-kreis').attr('r', 9);
    haken.append('path').attr('class', 'haken').attr('d', 'M-5 0 l3 3 l6 -7');
  }
  const name = innen.append('text')
    .attr('class', 'nadel-name')
    .attr('y', 40)
    .attr('text-anchor', 'middle')
    .attr('font-size', 18)
    .text(ort.name || '');
  let kasten = { x: -36, y: 22, width: 72, height: 24 };
  try {
    const box = name.node().getBBox();
    if (box.width > 0) kasten = box;
  } catch {
    // Die Karte ist noch nicht sichtbar: Schätzwert reicht fürs Schild.
    kasten = { x: -(String(ort.name || '').length * 5), y: 22, width: String(ort.name || '').length * 10, height: 24 };
  }
  innen.insert('rect', '.nadel-name')
    .attr('class', 'nadel-schild')
    .attr('x', kasten.x - 6)
    .attr('y', kasten.y - 2)
    .attr('width', kasten.width + 12)
    .attr('height', kasten.height + 6)
    .attr('rx', 8);
}

function hausZeichnen(g) {
  g.append('path').attr('class', 'haus').attr('d', 'M-8 2 L0 -8 L8 2 V8 H-8 Z');
  g.append('rect').attr('class', 'tuer').attr('x', -2).attr('y', 2).attr('width', 4).attr('height', 6);
}

function bettZeichnen(g) {
  g.append('rect').attr('class', 'bett').attr('x', -9).attr('y', -2).attr('width', 18).attr('height', 9).attr('rx', 2);
  g.append('rect').attr('class', 'kissen').attr('x', -8).attr('y', -5).attr('width', 7).attr('height', 5).attr('rx', 1.5);
  g.append('path').attr('class', 'bett-fuss').attr('d', 'M-9 7 v3 M9 7 v3');
}

function ankerZeichnen(g) {
  g.append('circle').attr('class', 'anker').attr('cy', -8).attr('r', 3);
  g.append('path').attr('class', 'anker').attr('d', 'M0 -5 v14 M-7 2 h14 M0 9 q-8 0 -8 -6 M0 9 q8 0 8 -6');
}

function miniZugZeichnen(g) {
  g.append('rect').attr('class', 'mini-zug').attr('x', -9).attr('y', -4).attr('width', 16).attr('height', 9).attr('rx', 2);
  g.append('rect').attr('class', 'fenster').attr('x', 2).attr('y', -2).attr('width', 4).attr('height', 3).attr('rx', 0.5);
  g.append('circle').attr('class', 'rad').attr('cx', -4).attr('cy', 6).attr('r', 2);
  g.append('circle').attr('class', 'rad').attr('cx', 5).attr('cy', 6).attr('r', 2);
}

function schiffZeichnen(flip, aufSee) {
  const g = flip.append('g').attr('class', aufSee ? 'schiff auf-see' : 'schiff im-hafen');
  g.append('path').attr('class', 'kielwasser').attr('d', 'M-46 10 q10 -6 18 0 t16 0');
  g.append('path').attr('class', 'kielwasser').attr('d', 'M-40 16 q8 -4 14 0 t12 0');
  const koerper = g.append('g').attr('class', 'schiff-koerper');
  koerper.append('path').attr('class', 'rumpf').attr('d', 'M-34 4 h58 l10 12 h-78 q4 -6 10 -12 z');
  koerper.append('rect').attr('class', 'aufbau').attr('x', -16).attr('y', -16).attr('width', 36).attr('height', 20).attr('rx', 4);
  koerper.append('circle').attr('class', 'fenster').attr('cx', -16).attr('cy', 6).attr('r', 2.4);
  koerper.append('circle').attr('class', 'fenster').attr('cx', -6).attr('cy', 6).attr('r', 2.4);
  koerper.append('circle').attr('class', 'fenster').attr('cx', 4).attr('cy', 6).attr('r', 2.4);
  koerper.append('circle').attr('class', 'fenster').attr('cx', 14).attr('cy', 6).attr('r', 2.4);
  koerper.append('circle').attr('class', 'schornstein').attr('cx', 8).attr('cy', -24).attr('r', 7);
  koerper.append('rect').attr('class', 'schornstein-band').attr('x', 2).attr('y', -26).attr('width', 12).attr('height', 4).attr('rx', 1);
  const rauch = g.append('g').attr('class', 'rauch');
  rauch.append('circle').attr('cx', 8).attr('cy', -36).attr('r', 4);
  rauch.append('circle').attr('cx', 14).attr('cy', -46).attr('r', 6);
  rauch.append('circle').attr('cx', 4).attr('cy', -54).attr('r', 4);
  ankerZeichnen(g.append('g').attr('class', 'anker-gruppe').attr('transform', 'translate(-24,18) scale(0.7)'));
}

function zugZeichnen(flip, innen) {
  const g = flip.append('g').attr('class', 'zug');
  const koerper = g.append('g').attr('class', 'zug-koerper');
  koerper.append('rect').attr('class', 'zug-huelle').attr('x', -36).attr('y', -8).attr('width', 28).attr('height', 20).attr('rx', 4);
  koerper.append('rect').attr('class', 'zug-huelle').attr('x', -6).attr('y', -16).attr('width', 34).attr('height', 28).attr('rx', 6);
  koerper.append('rect').attr('class', 'fenster').attr('x', -30).attr('y', -3).attr('width', 8).attr('height', 7).attr('rx', 1.5);
  koerper.append('rect').attr('class', 'fenster').attr('x', -18).attr('y', -3).attr('width', 8).attr('height', 7).attr('rx', 1.5);
  koerper.append('rect').attr('class', 'fenster').attr('x', 2).attr('y', -10).attr('width', 10).attr('height', 8).attr('rx', 1.5);
  koerper.append('rect').attr('class', 'fenster').attr('x', 16).attr('y', -10).attr('width', 8).attr('height', 8).attr('rx', 1.5);
  koerper.append('circle').attr('class', 'rad').attr('cx', -26).attr('cy', 14).attr('r', 4);
  koerper.append('circle').attr('class', 'rad').attr('cx', -12).attr('cy', 14).attr('r', 4);
  koerper.append('circle').attr('class', 'rad').attr('cx', 6).attr('cy', 14).attr('r', 4);
  koerper.append('circle').attr('class', 'rad').attr('cx', 20).attr('cy', 14).attr('r', 4);
  innen.append('text').attr('class', 'zzz').attr('x', -6).attr('y', -34).text('Zzz');
}

function sbahnZeichnen(flip) {
  const g = flip.append('g').attr('class', 'sbahn');
  g.append('rect').attr('class', 'sbahn-huelle').attr('x', -32).attr('y', -12).attr('width', 64).attr('height', 24).attr('rx', 6);
  g.append('rect').attr('class', 'fenster').attr('x', -24).attr('y', -6).attr('width', 12).attr('height', 8).attr('rx', 1.5);
  g.append('rect').attr('class', 'fenster').attr('x', -6).attr('y', -6).attr('width', 12).attr('height', 8).attr('rx', 1.5);
  g.append('rect').attr('class', 'fenster').attr('x', 12).attr('y', -6).attr('width', 12).attr('height', 8).attr('rx', 1.5);
  g.append('circle').attr('class', 'rad').attr('cx', -18).attr('cy', 14).attr('r', 4);
  g.append('circle').attr('class', 'rad').attr('cx', 18).attr('cy', 14).attr('r', 4);
  g.append('path').attr('class', 'strom').attr('d', 'M0 -12 v-8');
}

function taxiZeichnen(flip) {
  const g = flip.append('g').attr('class', 'taxi');
  g.append('path').attr('class', 'auto').attr('d', 'M-28 4 l8 -14 h28 l8 14 v10 h-44 z');
  g.append('rect').attr('class', 'fenster').attr('x', -12).attr('y', -8).attr('width', 16).attr('height', 8).attr('rx', 2);
  g.append('circle').attr('class', 'rad').attr('cx', -14).attr('cy', 14).attr('r', 5);
  g.append('circle').attr('class', 'rad').attr('cx', 16).attr('cy', 14).attr('r', 5);
}

function leuteZeichnen(innen, schlafend) {
  const g = innen.append('g').attr('class', schlafend ? 'leute leute-schlaf' : 'leute');
  if (schlafend) {
    g.attr('transform', 'translate(0,-34)');
    g.append('rect').attr('class', 'kissen').attr('x', -30).attr('y', -6).attr('width', 16).attr('height', 11).attr('rx', 4);
    g.append('rect').attr('class', 'kissen').attr('x', -6).attr('y', -4).attr('width', 16).attr('height', 11).attr('rx', 4);
    g.append('rect').attr('class', 'kleid').attr('x', -28).attr('y', 4).attr('width', 24).attr('height', 10).attr('rx', 5);
    g.append('rect').attr('class', 'kleid').attr('x', -4).attr('y', 6).attr('width', 22).attr('height', 9).attr('rx', 4);
    g.append('circle').attr('class', 'haut').attr('cx', -20).attr('cy', 0).attr('r', 6);
    g.append('circle').attr('class', 'haut').attr('cx', 4).attr('cy', 2).attr('r', 5.5);
    g.append('rect').attr('class', 'koffer').attr('x', 24).attr('y', 4).attr('width', 12).attr('height', 10).attr('rx', 2);
    g.append('text').attr('class', 'zzz zzz-sichtbar').attr('x', 22).attr('y', -16).text('Zzz');
    return;
  }
  person(g, -16, 1);
  person(g, 8, 0.9);
  g.append('rect').attr('class', 'koffer').attr('x', 22).attr('y', -2).attr('width', 12).attr('height', 10).attr('rx', 2);
  g.append('path').attr('class', 'koffer-griff').attr('d', 'M25 -2 v-3 h6 v3');
}

function person(g, x, faktor) {
  const p = g.append('g').attr('transform', `translate(${x},0) scale(${faktor})`);
  p.append('circle').attr('class', 'haut').attr('cy', -20).attr('r', 7);
  p.append('path').attr('class', 'kleid').attr('d', 'M-7 -12 h14 l3 16 h-20 z');
  p.append('path').attr('class', 'bein').attr('d', 'M-3 4 v8 M3 4 v8');
}

function himmelZeichnen(g) {
  g.append('path')
    .attr('class', 'mond')
    .attr('fill-rule', 'evenodd')
    .attr('d', 'M48 26 a16 16 0 1 0 0.01 0 z M58 32 a11 11 0 1 1 -0.01 0 z');
  const sterne = [[18, 28], [78, 22], [90, 58], [30, 70], [110, 36]];
  for (const [x, y] of sterne) {
    g.append('circle').attr('class', 'stern').attr('cx', x).attr('cy', y).attr('r', 2.2);
  }
}

function moeweZeichnen(g) {
  g.append('path').attr('class', 'fluegel fluegel-links').attr('d', 'M0 0 q-10 -8 -18 0');
  g.append('path').attr('class', 'fluegel fluegel-rechts').attr('d', 'M0 0 q10 -8 18 0');
}
