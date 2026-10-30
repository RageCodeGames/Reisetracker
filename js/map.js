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
const SCHIFF_URL = new URL('../icons/schiff.svg', import.meta.url).href;
/** Figuren und Nadeln ca. 30 % kleiner als zuvor. */
const FIGUR_SKALA = 0.7;
const SCHRIFT_PX = 14;
/** Orte näher als so viele Bildschirm-Pixel teilen sich eine Nadel. */
const CLUSTER_PX = 40;
const NADEL_RADIUS = 13;
/** Comic-Schiff aus icons/schiff.svg, ca. 60px breit auf der Karte. */
const SCHIFF_BREITE = 60;
const SCHIFF_VB_W = 240;
const SCHIFF_VB_H = 124;
/** Schornstein: ca. 42 % der Breite von links, ganz oben. */
const SCHIFF_SCHORNSTEIN = { x: SCHIFF_VB_W * 0.42, y: 4 };

let atlasVersprechen = null;
let schiffVorlage = null;

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

/** SVG unverändert laden; Fenstergruppen bekommen Klassen für die Nacht. */
async function schiffSvgLaden() {
  if (schiffVorlage) return schiffVorlage;
  const antwort = await fetch(SCHIFF_URL);
  if (!antwort.ok) throw new Error('schiff');
  const text = await antwort.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('schiff');
  const root = doc.documentElement;
  for (const kind of root.children) {
    const fill = kind.getAttribute('fill');
    if (fill === '#7fd3e6') kind.setAttribute('class', 'schiff-fenster');
    if (fill === '#ffffff' && kind.querySelector('circle')) {
      kind.setAttribute('class', 'schiff-bullauge');
    }
  }
  schiffVorlage = root;
  return schiffVorlage;
}

/**
 * Baut die Karte einmal. aktualisieren setzt Fahrzeug, Route und Nacht
 * neu, ohne die Welt neu zu laden und ohne den Zoom zu verwerfen.
 */
export async function karteErstellen(container) {
  const [topo] = await Promise.all([atlasLaden(), schiffSvgLaden()]);
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
  const polaroidGruppe = zoomGruppe.append('g').attr('class', 'polaroids');
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
  let grussKlick = null;
  let grussDaten = { updates: [], neuester: null, neuIds: new Set(), fotoUrl: null };
  let blaseEingeklappt = false;
  let blaseGrussId = null;
  const marken = [];

  const blase = document.createElement('div');
  blase.className = 'gruss-blase';
  blase.hidden = true;
  container.append(blase);

  const verhalten = zoom()
    .scaleExtent([1, 14])
    .on('zoom', (ereignis) => {
      transform = ereignis.transform;
      zoomGruppe.attr('transform', transform);
      // Cluster hängen vom Zoom ab: Nadeln neu, Fahrzeuge nur skalieren.
      nadelnNeu();
      blasePlatzieren();
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

  function marke(gruppe, x, y, versatz = 0, klasse = '', typ = 'nadel') {
    const aussen = gruppe.append('g').attr('transform', `translate(${x},${y})`);
    const innen = aussen.append('g');
    if (klasse) innen.attr('class', klasse);
    marken.push({ innen, versatz, typ });
    return innen;
  }

  function nadelnNeu() {
    const halten = marken.filter((m) => m.typ !== 'nadel');
    nadelGruppe.selectAll('*').remove();
    marken.length = 0;
    for (const stueck of halten) marken.push(stueck);
    nadelnZeichnen();
    markenSkalieren();
    schilderOrdnen();
  }

  function schilderOrdnen() {
    const knoepfe = container.parentElement?.querySelector('.karten-knopfleiste')?.getBoundingClientRect();
    const eintraege = [...container.querySelectorAll('.nadel-innen')].map((g) => ({
      innen: g,
      kopf: g.querySelector('.nadel-kopf'),
      schild: g.querySelector('.nadel-schild'),
      name: g.querySelector('.nadel-name'),
    })).filter((eintrag) => eintrag.schild && eintrag.name && eintrag.kopf);

    const trifft = (a, b) => !(a.right < b.left + 2 || a.left > b.right - 2 || a.bottom < b.top + 2 || a.top > b.bottom - 2);
    const kastenSchild = (eintrag) => eintrag.schild.getBoundingClientRect();
    const kastenKopf = (eintrag) => eintrag.kopf.getBoundingClientRect();

    const seiten = ['unten', 'rechts', 'links', 'oben'];
    const scoreFuer = (eintrag, seite) => {
      schildAnSeite(eintrag, seite);
      const schild = kastenSchild(eintrag);
      let score = 0;
      if (knoepfe && trifft(schild, knoepfe)) score += 1000;
      for (const andere of eintraege) {
        if (andere === eintrag) continue;
        if (trifft(schild, kastenKopf(andere))) score += 200;
        if (andere.seite && trifft(schild, kastenSchild(andere))) score += 100;
      }
      if (seite === 'unten') score -= 2;
      if (seite === 'rechts') score -= 1;
      return score;
    };

    for (const eintrag of eintraege) {
      let beste = 'unten';
      let besteScore = Infinity;
      for (const seite of seiten) {
        const score = scoreFuer(eintrag, seite);
        if (score < besteScore) {
          besteScore = score;
          beste = seite;
        }
      }
      schildAnSeite(eintrag, beste);
      eintrag.seite = beste;
    }

    // Zweiter Durchgang, falls zwei Schilder noch kollidieren.
    for (let runde = 0; runde < 3; runde += 1) {
      let geaendert = false;
      for (const eintrag of eintraege) {
        const schild = kastenSchild(eintrag);
        const kollision = eintraege.some((andere) => andere !== eintrag && (
          trifft(schild, kastenKopf(andere))
          || (andere.seite && trifft(schild, kastenSchild(andere)))
        )) || (knoepfe && trifft(schild, knoepfe));
        if (!kollision) continue;
        let beste = eintrag.seite;
        let besteScore = Infinity;
        for (const seite of seiten) {
          const score = scoreFuer(eintrag, seite);
          if (score < besteScore) {
            besteScore = score;
            beste = seite;
          }
        }
        if (beste !== eintrag.seite) geaendert = true;
        schildAnSeite(eintrag, beste);
        eintrag.seite = beste;
      }
      if (!geaendert) break;
    }
  }

  function schildAnSeite(eintrag, seite) {
    const pad = 5;
    const abstand = 5;
    const r = NADEL_RADIUS;
    eintrag.name.setAttribute('font-size', SCHRIFT_PX);
    eintrag.name.setAttribute('text-anchor', 'middle');
    eintrag.name.setAttribute('dominant-baseline', 'middle');
    eintrag.name.setAttribute('x', 0);
    eintrag.name.setAttribute('y', 0);
    let box;
    try {
      box = eintrag.name.getBBox();
    } catch {
      const laenge = String(eintrag.name.textContent || '').length;
      box = { x: -laenge * 4, y: -8, width: laenge * 8, height: 16 };
    }
    const w = box.width + pad * 2;
    const h = box.height + pad * 2;
    let x = 0;
    let y = 0;
    if (seite === 'unten') {
      x = 0;
      y = r + abstand + h / 2;
    } else if (seite === 'oben') {
      x = 0;
      y = -(r + abstand + h / 2);
    } else if (seite === 'rechts') {
      x = r + abstand + w / 2;
      y = 0;
    } else {
      x = -(r + abstand + w / 2);
      y = 0;
    }
    eintrag.name.setAttribute('x', x);
    eintrag.name.setAttribute('y', y);
    let fertig;
    try {
      fertig = eintrag.name.getBBox();
    } catch {
      fertig = { x: x - w / 2 + pad, y: y - h / 2 + pad, width: w - pad * 2, height: h - pad * 2 };
    }
    eintrag.schild.setAttribute('x', fertig.x - pad);
    eintrag.schild.setAttribute('y', fertig.y - pad);
    eintrag.schild.setAttribute('width', fertig.width + pad * 2);
    eintrag.schild.setAttribute('height', fertig.height + pad * 2);
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
      } else if (aktuell) {
        bisher.aktuell = true;
        bisher.besucht = false;
        bisher.eintrag = eintrag;
      } else if (besucht && !bisher.aktuell) {
        bisher.besucht = true;
      } else if (!bisher.aktuell && !besucht && ortBesucht(bisher.eintrag, zeit)) {
        bisher.eintrag = eintrag;
        bisher.besucht = false;
      }
    }

    const punkte = [];
    for (const wert of orte.values()) {
      const pos = xy(wert.eintrag.lat, wert.eintrag.lon);
      if (!pos) continue;
      const bildschirm = transform.apply([pos.x, pos.y]);
      punkte.push({
        ...wert,
        x: pos.x,
        y: pos.y,
        sx: bildschirm[0],
        sy: bildschirm[1],
      });
    }

    for (const cluster of orteClustern(punkte, CLUSTER_PX)) {
      const x = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
      const y = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
      const aktuell = cluster.some((p) => p.aktuell);
      const besucht = cluster.every((p) => p.besucht) && !aktuell;
      const vertreter = cluster.find((p) => p.aktuell)
        || cluster.slice().sort((a, b) => artPrio(b.eintrag.art) - artPrio(a.eintrag.art))[0];
      const name = gemeinsamerName(cluster.map((p) => p.eintrag.name));
      const innen = marke(nadelGruppe, x, y, 0, 'nadel-innen', 'nadel');
      nadelSymbol(innen, vertreter.eintrag, besucht, aktuell, name);
      innen.style('cursor', 'pointer')
        .attr('role', 'button')
        .attr('tabindex', 0)
        .on('click', (ereignis) => {
          ereignis.sourceEvent?.stopPropagation();
          ortKlick?.(vertreter.eintrag);
        });
    }
  }

  function fahrzeugZeichnen() {
    fahrzeugGruppe.selectAll('*').remove();
    const hier = zielPunkt();
    if (!hier) return;
    const pos = xy(hier.lat, hier.lon);
    if (!pos) return;
    const innen = marke(fahrzeugGruppe, pos.x, pos.y, 0, '', 'fahrzeug');
    const art = fahrzeugArt();
    const richtung = fahrzeugRichtung();
    // Schiff hat eigene Zielbreite (60px), andere Figuren nutzen FIGUR_SKALA.
    if (art === 'schiff' || art === 'schiff-hafen') {
      const flip = innen.append('g');
      if (richtung === 'links') flip.attr('transform', 'scale(-1,1)');
      schiffZeichnen(flip, art === 'schiff');
      return;
    }
    const skala = innen.append('g').attr('transform', `scale(${FIGUR_SKALA})`);
    const flip = skala.append('g');
    if (richtung === 'links') flip.attr('transform', 'scale(-1,1)');
    if (art === 'zug') zugZeichnen(flip, skala);
    else if (art === 'sbahn') sbahnZeichnen(flip);
    else if (art === 'taxi') taxiZeichnen(flip);
    else leuteZeichnen(skala, schlaeft());
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
    fahrzeugZeichnen();
    polaroidsZeichnen();
    nadelnNeu();
    blaseZeichnen();
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

  function aktualisieren(neuesTrip, neuerStatus, neueZeit, neueGruesse = null) {
    const neueId = neuesTrip?.id || null;
    const gewechselt = angepasst && neueId !== tripId;
    trip = neuesTrip;
    tripId = neueId;
    status = neuerStatus;
    zeit = neueZeit instanceof Date ? neueZeit : new Date(neueZeit);
    if (neueGruesse) grussDaten = neueGruesse;
    svg.classed('nacht', istNachtLokal(zeit, trip?.zeitzone || 'Europe/Berlin'));
    if (!angepasst || gewechselt) {
      anpassenUndZurueck();
      angepasst = true;
    } else szeneNeu();
  }

  function setzeOrtKlick(fn) {
    ortKlick = typeof fn === 'function' ? fn : null;
  }

  function setzeGrussKlick(fn) {
    grussKlick = typeof fn === 'function' ? fn : null;
  }

  function polaroidsZeichnen() {
    polaroidGruppe.selectAll('*').remove();
    marken.splice(0, marken.length, ...marken.filter((m) => m.typ !== 'polaroid'));
    const neuester = grussDaten.neuester;
    const liste = (grussDaten.updates || []).filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));
    for (const gruss of liste) {
      // Pin des neuesten Grußes am Schiff/an den Figuren weglassen – steht schon in der Blase.
      if (neuester && gruss.id === neuester.id && amFahrzeug(gruss)) continue;
      const pos = xy(gruss.lat, gruss.lon);
      if (!pos) continue;
      const innen = marke(polaroidGruppe, pos.x, pos.y, 0, 'polaroid-innen', 'polaroid');
      polaroidZeichnen(innen, gruss, grussDaten.neuIds?.has(gruss.id));
      innen.style('cursor', 'pointer')
        .attr('role', 'button')
        .on('click', (ereignis) => {
          ereignis.sourceEvent?.stopPropagation();
          grussKlick?.(gruss);
        });
      const foto = (gruss.fotos || [])[0];
      if (foto && grussDaten.fotoUrl) {
        const bild = innen.select('.polaroid-foto');
        const knoten = innen.node()?.parentNode;
        const laden = async () => {
          try {
            const url = await grussDaten.fotoUrl(foto);
            if (url && bild.node()) bild.attr('href', url);
          } catch {
            // Kleines Foto fehlt: Polaroid bleibt ohne Bild.
          }
        };
        if (knoten && typeof IntersectionObserver === 'function') {
          const observer = new IntersectionObserver((eintraege) => {
            if (!eintraege.some((e) => e.isIntersecting)) return;
            observer.disconnect();
            laden();
          }, { root: container, rootMargin: '80px' });
          observer.observe(knoten);
        } else laden();
      }
    }
  }

  function amFahrzeug(gruss) {
    const hier = zielPunkt();
    if (!hier) return false;
    const a = xy(gruss.lat, gruss.lon);
    const b = xy(hier.lat, hier.lon);
    if (!a || !b) return false;
    return Math.hypot(a.x - b.x, a.y - b.y) < 36;
  }

  function blaseZeichnen() {
    const gruss = grussDaten.neuester;
    if (!gruss) {
      blase.hidden = true;
      blase.replaceChildren();
      blaseGrussId = null;
      return;
    }
    if (blaseGrussId !== gruss.id) {
      blaseEingeklappt = false;
      blaseGrussId = gruss.id;
    }
    blase.hidden = false;
    blase.replaceChildren();
    blase.classList.toggle('gruss-blase-klein', blaseEingeklappt);
    blase.classList.remove('gruss-blase-unten');

    if (blaseEingeklappt) {
      const mini = document.createElement('button');
      mini.type = 'button';
      mini.className = 'gruss-blase-mini';
      mini.setAttribute('aria-label', 'Gruß aufklappen');
      mini.innerHTML = '<svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true"><path d="M4 3h20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-5 5v-5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#fffdf8" stroke="#1a1208" stroke-width="2" stroke-linejoin="round"/></svg>';
      if (grussDaten.neuIds?.has(gruss.id)) {
        const neu = document.createElement('span');
        neu.className = 'neu-punkt';
        neu.textContent = 'Neu!';
        mini.append(neu);
      }
      mini.addEventListener('click', (ereignis) => {
        ereignis.stopPropagation();
        blaseEingeklappt = false;
        blaseZeichnen();
      });
      blase.append(mini);
      requestAnimationFrame(() => requestAnimationFrame(blasePlatzieren));
      return;
    }

    const zu = document.createElement('button');
    zu.type = 'button';
    zu.className = 'gruss-blase-zu';
    zu.setAttribute('aria-label', 'Gruß einklappen');
    zu.textContent = '×';
    zu.addEventListener('click', (ereignis) => {
      ereignis.stopPropagation();
      blaseEingeklappt = true;
      blaseZeichnen();
    });
    blase.append(zu);

    const inhalt = document.createElement('button');
    inhalt.type = 'button';
    inhalt.className = 'gruss-blase-inhalt';
    inhalt.addEventListener('click', (ereignis) => {
      ereignis.stopPropagation();
      grussKlick?.(gruss);
    });

    if (grussDaten.neuIds?.has(gruss.id)) {
      const neu = document.createElement('span');
      neu.className = 'neu-punkt';
      neu.textContent = 'Neu!';
      inhalt.append(neu);
    }
    const kopf = document.createElement('p');
    kopf.className = 'gruss-blase-kopf';
    kopf.textContent = `Gruß von ${gruss.von || 'unterwegs'} · ${vorRelativLokal(gruss.zeit)}`;
    inhalt.append(kopf);
    if (gruss.text) {
      const text = document.createElement('p');
      text.className = 'gruss-blase-text';
      text.textContent = gruss.text;
      inhalt.append(text);
    }
    const fotos = Array.isArray(gruss.fotos) ? gruss.fotos : [];
    if (fotos.length > 0) {
      const reihe = document.createElement('div');
      reihe.className = 'gruss-blase-fotos';
      const rest = fotos.length > 3 ? fotos.length - 3 : 0;
      const zeigen = rest > 0 ? fotos.slice(0, 3) : fotos;
      for (const foto of zeigen) {
        const img = document.createElement('img');
        img.className = 'gruss-blase-foto';
        img.alt = 'Foto zum Gruß';
        reihe.append(img);
        if (grussDaten.fotoUrl) {
          grussDaten.fotoUrl(foto).then((url) => {
            if (url && img.isConnected) img.src = url;
          }).catch(() => { img.hidden = true; });
          img.addEventListener('load', () => blasePlatzieren());
        }
      }
      if (rest > 0) {
        const mehr = document.createElement('span');
        mehr.className = 'gruss-blase-mehr';
        mehr.textContent = `+${rest}`;
        reihe.append(mehr);
      }
      inhalt.append(reihe);
    }
    blase.append(inhalt);
    requestAnimationFrame(() => requestAnimationFrame(blasePlatzieren));
  }

  function blasePlatzieren() {
    if (blase.hidden) return;
    const fahrzeug = container.querySelector('.fahrzeuge > g');
    const rahmen = container.getBoundingClientRect();
    if (!fahrzeug || rahmen.width === 0) return;
    const box = fahrzeug.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    const ankerX = box.left + box.width / 2 - rahmen.left;
    const obenY = box.top - rahmen.top;
    const untenY = box.bottom - rahmen.top;

    blase.style.left = `${ankerX}px`;
    const polaroidKaesten = [...container.querySelectorAll('.polaroids > g')]
      .map((g) => g.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    const trifft = (a, b) => !(a.right < b.left + 2 || a.left > b.right - 2 || a.bottom < b.top + 2 || a.top > b.bottom - 2);
    const frei = (kasten) => !polaroidKaesten.some((p) => trifft(kasten, p));

    blase.classList.remove('gruss-blase-unten');
    blase.style.top = `${obenY}px`;
    let eigene = blase.getBoundingClientRect();
    const obenOk = eigene.top >= rahmen.top + 8 && frei(eigene);
    if (!obenOk) {
      blase.classList.add('gruss-blase-unten');
      blase.style.top = `${untenY + 8 + eigene.height / 2}px`;
      eigene = blase.getBoundingClientRect();
      const untenOk = eigene.bottom <= rahmen.bottom - 8 && frei(eigene);
      if (!untenOk) {
        // Unten auch belegt: oben belassen, damit der Gruß sichtbar bleibt.
        blase.classList.remove('gruss-blase-unten');
        blase.style.top = `${obenY}px`;
        eigene = blase.getBoundingClientRect();
      }
    }

    if (eigene.left < rahmen.left + 8) {
      blase.style.left = `${eigene.width / 2 + 8}px`;
    } else if (eigene.right > rahmen.right - 8) {
      blase.style.left = `${rahmen.width - eigene.width / 2 - 8}px`;
    }
  }

  function vorRelativLokal(iso) {
    const zeitpunkt = new Date(iso);
    if (Number.isNaN(zeitpunkt.getTime())) return '';
    const minuten = Math.max(0, Math.round((Date.now() - zeitpunkt.getTime()) / 60000));
    if (minuten < 1) return 'gerade eben';
    if (minuten === 1) return 'vor 1 Min.';
    if (minuten < 60) return `vor ${minuten} Min.`;
    const stunden = Math.round(minuten / 60);
    if (stunden === 1) return 'vor 1 Std.';
    if (stunden < 24) return `vor ${stunden} Std.`;
    const tage = Math.round(stunden / 24);
    return tage === 1 ? 'vor 1 Tag' : `vor ${tage} Tagen`;
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

  return { aktualisieren, ganzeReise, woSindWir, setzeOrtKlick, setzeGrussKlick, zerstoeren };
}

let polaroidClipNr = 0;

function polaroidZeichnen(innen, gruss, neu) {
  innen.append('rect')
    .attr('class', 'polaroid-rahmen')
    .attr('x', -18)
    .attr('y', -22)
    .attr('width', 36)
    .attr('height', 42)
    .attr('rx', 3);
  if ((gruss.fotos || []).length > 0) {
    polaroidClipNr += 1;
    const clipId = `rt-polaroid-${polaroidClipNr}`;
    innen.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', -14)
      .attr('y', -18)
      .attr('width', 28)
      .attr('height', 28);
    innen.append('image')
      .attr('class', 'polaroid-foto')
      .attr('clip-path', `url(#${clipId})`)
      .attr('x', -14)
      .attr('y', -18)
      .attr('width', 28)
      .attr('height', 28)
      .attr('preserveAspectRatio', 'xMidYMid slice');
  } else {
    const symbol = innen.append('g').attr('class', 'polaroid-symbol').attr('transform', 'translate(0,-4)');
    symbol.append('path')
      .attr('d', 'M-10 -6 h20 v12 h-6 l-4 5 l-4 -5 h-6 z')
      .attr('class', 'polaroid-blase');
  }
  if (neu) {
    innen.append('circle').attr('class', 'polaroid-neu').attr('cx', 14).attr('cy', -20).attr('r', 6);
  }
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

function nadelSymbol(innen, ort, besucht, aktuell, anzeigeName) {
  if (aktuell) {
    innen.append('circle').attr('class', 'nadel-ring').attr('r', 18);
  }
  innen.append('circle').attr('class', 'nadel-kopf').attr('r', NADEL_RADIUS);
  const symbol = innen.append('g').attr('class', 'nadel-symbol').attr('transform', `scale(${FIGUR_SKALA})`);
  if (ort.art === 'hotel') bettZeichnen(symbol);
  else if (ort.art === 'hafen') ankerZeichnen(symbol.append('g').attr('transform', 'scale(0.55)'));
  else if (ort.art === 'bahnhof') miniZugZeichnen(symbol);
  else hausZeichnen(symbol);
  if (besucht) {
    const haken = innen.append('g').attr('transform', 'translate(9,-10)');
    haken.append('circle').attr('class', 'haken-kreis').attr('r', 7);
    haken.append('path').attr('class', 'haken').attr('d', 'M-4 0 l2.5 2.5 l5 -6');
  }
  const text = anzeigeName || ort.name || '';
  innen.append('text')
    .attr('class', 'nadel-name')
    .attr('y', NADEL_RADIUS + 16)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', SCHRIFT_PX)
    .text(text);
  // Platzhalter-Schild; schilderOrdnen setzt Lage und Größe.
  innen.insert('rect', '.nadel-name')
    .attr('class', 'nadel-schild')
    .attr('x', -20)
    .attr('y', NADEL_RADIUS + 4)
    .attr('width', 40)
    .attr('height', 20)
    .attr('rx', 7);
}

function artPrio(art) {
  if (art === 'hotel') return 4;
  if (art === 'hafen') return 3;
  if (art === 'zuhause') return 2;
  if (art === 'bahnhof') return 1;
  return 0;
}

/** Gemeinsamer Kurzname für eine Nadelgruppe, z. B. „Hamburg“. */
function gemeinsamerName(namen) {
  const einzig = [...new Set(namen.filter(Boolean))];
  if (einzig.length === 0) return 'Ort';
  if (einzig.length === 1) return einzig[0];
  const sortiert = [...einzig].sort((a, b) => a.length - b.length);
  for (const kandidat of sortiert) {
    if (einzig.every((name) => name === kandidat || name.includes(kandidat))) return kandidat;
  }
  const stop = /^(hbf|bahnhof|hauptbahnhof|terminal|hotel|hafen|zum|nach|am|an|der|die|das|in)$/i;
  const listen = einzig.map((name) => name.split(/[\s/,-]+/).filter((wort) => wort.length >= 3 && !stop.test(wort)));
  let best = '';
  for (const wort of listen[0] || []) {
    if (listen.every((liste) => liste.some((w) => w.toLowerCase() === wort.toLowerCase()))) {
      if (wort.length > best.length) best = wort;
    }
  }
  return best || sortiert[0];
}

/** Vereinigt Orte, die auf dem Bildschirm näher als maxPx beieinander liegen. */
function orteClustern(punkte, maxPx) {
  if (punkte.length === 0) return [];
  const eltern = punkte.map((_, i) => i);
  const find = (i) => {
    let p = i;
    while (eltern[p] !== p) p = eltern[p];
    let k = i;
    while (eltern[k] !== p) {
      const n = eltern[k];
      eltern[k] = p;
      k = n;
    }
    return p;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) eltern[rb] = ra;
  };
  const grenze = maxPx * maxPx;
  for (let i = 0; i < punkte.length; i += 1) {
    for (let j = i + 1; j < punkte.length; j += 1) {
      const dx = punkte[i].sx - punkte[j].sx;
      const dy = punkte[i].sy - punkte[j].sy;
      if (dx * dx + dy * dy <= grenze) unite(i, j);
    }
  }
  const gruppen = new Map();
  for (let i = 0; i < punkte.length; i += 1) {
    const wurzel = find(i);
    if (!gruppen.has(wurzel)) gruppen.set(wurzel, []);
    gruppen.get(wurzel).push(punkte[i]);
  }
  return [...gruppen.values()];
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
  const skala = SCHIFF_BREITE / SCHIFF_VB_W;
  const g = flip.append('g').attr('class', aufSee ? 'schiff auf-see' : 'schiff im-hafen');
  // Kielwasser hinter dem Heck (links, Schiff schaut nach rechts).
  g.append('path').attr('class', 'kielwasser').attr('d', 'M-48 10 q12 -7 22 0 t22 0');
  g.append('path').attr('class', 'kielwasser').attr('d', 'M-42 17 q10 -5 18 0 t18 0');

  const koerper = g.append('g').attr('class', 'schiff-koerper');
  const inhalt = koerper.append('g')
    .attr('class', 'schiff-svg')
    .attr('transform', `scale(${skala}) translate(${-SCHIFF_VB_W / 2}, ${-SCHIFF_VB_H / 2})`);
  if (schiffVorlage) {
    const ziel = inhalt.node();
    for (const kind of schiffVorlage.children) {
      ziel.appendChild(document.importNode(kind, true));
    }
  }

  const rauchX = (SCHIFF_SCHORNSTEIN.x - SCHIFF_VB_W / 2) * skala;
  const rauchY = (SCHIFF_SCHORNSTEIN.y - SCHIFF_VB_H / 2) * skala;
  const rauch = koerper.append('g').attr('class', 'rauch').attr('transform', `translate(${rauchX},${rauchY})`);
  rauch.append('circle').attr('cx', 0).attr('cy', -4).attr('r', 3.5);
  rauch.append('circle').attr('cx', 5).attr('cy', -12).attr('r', 5);
  rauch.append('circle').attr('cx', -3).attr('cy', -20).attr('r', 3.5);

  ankerZeichnen(g.append('g').attr('class', 'anker-gruppe').attr('transform', 'translate(-22,22) scale(0.75)'));
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
