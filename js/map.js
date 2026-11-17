/**
 * Comic-Karte. Weltumriss von world-atlas, gezeichnet mit d3-geo.
 * Bibliotheken nur von cdn.jsdelivr.net, festgenagelte Versionen.
 * Die Position kommt aus dem Reiseplan, nicht aus dem Netz.
 */

import { geoMercator, geoPath, geoCentroid } from 'https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm';
import { select } from 'https://cdn.jsdelivr.net/npm/d3-selection@3.0.0/+esm';
import { zoom, zoomIdentity } from 'https://cdn.jsdelivr.net/npm/d3-zoom@3.0.0/+esm';
import { feature, mesh } from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
import { fahrtPunkte, streckeTeilen, istNachtAnPosition } from './trip.js';
import { KARTEN_ORTE, LAENDER_DE, MEERE } from './orte-karte.js';

const ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
const LAND10_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-10m.json';
/** Ab diesem Zoom die feinere Küstenlinie nachladen. */
const LAND10_ZOOM = 3.2;
/** Ab hier land-10m ohne Vereinfachung (volle Küsten). */
const LAND10_VOLL_ZOOM = 16;
/** Maximaler Zoom: Insel wie Koh Samui kann fast den Rahmen füllen. */
const ZOOM_MAX = 288;
const ZOOM_SCHRITT = 1.6;
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
let land10Versprechen = null;
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

function land10Laden() {
  if (!land10Versprechen) {
    land10Versprechen = fetch(LAND10_URL).then((antwort) => {
      if (!antwort.ok) throw new Error('land10');
      return antwort.json();
    }).then((topo) => polygoneMitBox(feature(topo, topo.objects.land))).catch((fehler) => {
      land10Versprechen = null;
      throw fehler;
    });
  }
  return land10Versprechen;
}

/** Polygone mit Bounding-Box, damit wir nur den sichtbaren Ausschnitt zeichnen. */
function polygoneMitBox(geo) {
  const liste = [];
  const features = geo.type === 'FeatureCollection' ? geo.features : [geo];
  for (const eintrag of features) {
    const geometrie = eintrag.geometry;
    if (!geometrie) continue;
    const polys = geometrie.type === 'Polygon'
      ? [geometrie.coordinates]
      : geometrie.type === 'MultiPolygon' ? geometrie.coordinates : [];
    for (const poly of polys) {
      let minLon = 180;
      let minLat = 90;
      let maxLon = -180;
      let maxLat = -90;
      for (const ring of poly) {
        for (const punkt of ring) {
          const lon = punkt[0];
          const lat = punkt[1];
          if (lon < minLon) minLon = lon;
          if (lat < minLat) minLat = lat;
          if (lon > maxLon) maxLon = lon;
          if (lat > maxLat) maxLat = lat;
        }
      }
      liste.push({ poly, minLon, minLat, maxLon, maxLat });
    }
  }
  return liste;
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

  // Meer und Wellen sitzen im Bildschirm, nicht in der Zoom-Gruppe:
  // so bleibt das Muster pixelgroß und erzeugt keinen weißen Schleier.
  const meer = svg.append('rect').attr('class', 'meer');
  const wellen = svg.append('rect')
    .attr('class', 'wellen-schleier')
    .attr('fill', 'url(#rt-wellen)');
  const zoomGruppe = svg.append('g').attr('class', 'zoom-gruppe');
  const landGruppe = zoomGruppe.append('g').attr('class', 'laender');
  const landFeinGruppe = zoomGruppe.append('g').attr('class', 'land-fein').style('display', 'none');
  const grenzGruppe = zoomGruppe.append('g').attr('class', 'land-grenzen').style('display', 'none');
  const schriftGruppe = zoomGruppe.append('g').attr('class', 'karten-schrift');
  const stadtGruppe = zoomGruppe.append('g').attr('class', 'karten-staedte');
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
  const grenzenMesh = mesh(topo, topo.objects.countries, (a, b) => a !== b);
  const grenzPfad = grenzGruppe.append('path')
    .datum(grenzenMesh)
    .attr('class', 'land-grenze');

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
  let land10Polygone = null;
  let zoomTimer = 0;
  let zoomGlaettung = false;
  const marken = [];

  const blase = document.createElement('div');
  blase.className = 'gruss-blase';
  blase.hidden = true;
  container.append(blase);

  const verhalten = zoom()
    .scaleExtent([1, ZOOM_MAX])
    .on('zoom', (ereignis) => {
      transform = ereignis.transform;
      zoomGruppe.attr('transform', transform);
      // Während des Zooms Größe am Bildschirm halten (nicht mitwachsen).
      markenSkalieren();
      labelsSkalieren();
    })
    .on('end', (ereignis) => {
      if (zoomGlaettung) return;
      clearTimeout(zoomTimer);
      const delay = ereignis.sourceEvent ? 90 : 0;
      zoomTimer = setTimeout(nachZoomZeichnen, delay);
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
    meer.attr('x', -84).attr('y', -52).attr('width', breite + 168).attr('height', hoehe + 104);
    wellen.attr('x', -84).attr('y', -52).attr('width', breite + 168).attr('height', hoehe + 104);
    projektion.fitExtent([[28, 28], [breite - 28, hoehe - 128]], flaecheDerReise());
    landPfade.attr('d', pfad);
    grenzPfad.attr('d', pfad);
    if (land10Polygone) landFeinZeichnen();
    verhalten.extent([[0, 0], [breite, hoehe]]);
    verhalten.translateExtent([[-40, -40], [breite + 40, hoehe + 40]]);
  }

  function regionKoordinaten(hier) {
    const alle = [];
    for (const eintrag of trip?.plan || []) {
      if (eintrag.typ === 'ort' && Number.isFinite(eintrag.lat) && Number.isFinite(eintrag.lon)) {
        alle.push({ lat: eintrag.lat, lon: eintrag.lon, land: eintrag.land || '' });
      }
    }
    if (!hier || !Number.isFinite(hier.lat) || !Number.isFinite(hier.lon)) return alle;
    let land = status?.land || '';
    if (!land && status?.status === 'fahrt' && status.von?.land && status.von.land === status.nach?.land) {
      land = status.von.land;
    }
    if (!land) {
      let beste = Infinity;
      for (const punkt of alle) {
        const d = Math.hypot(punkt.lat - hier.lat, punkt.lon - hier.lon);
        if (d < beste && punkt.land) {
          beste = d;
          land = punkt.land;
        }
      }
      // Fernflug: nicht das andere Kontinent-Ende als Region nehmen.
      if (beste > 12) land = '';
    }
    if (land) {
      const gleiche = alle.filter((punkt) => punkt.land === land);
      if (gleiche.length >= 2) return gleiche;
    }
    const nah = alle.filter((punkt) => Math.hypot(punkt.lat - hier.lat, punkt.lon - hier.lon) <= 12);
    if (nah.length >= 2) return nah;
    return [
      { lat: hier.lat - 4, lon: hier.lon - 4 },
      { lat: hier.lat + 4, lon: hier.lon + 4 },
      { lat: hier.lat, lon: hier.lon },
    ];
  }

  function regionTransform() {
    const coords = regionKoordinaten(zielPunkt());
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const punkt of coords) {
      const pos = projektion([punkt.lon, punkt.lat]);
      if (!pos || Number.isNaN(pos[0]) || Number.isNaN(pos[1])) continue;
      minX = Math.min(minX, pos[0]);
      minY = Math.min(minY, pos[1]);
      maxX = Math.max(maxX, pos[0]);
      maxY = Math.max(maxY, pos[1]);
    }
    if (!Number.isFinite(minX)) return zoomIdentity;
    const pad = 44;
    const w = Math.max(16, maxX - minX);
    const h = Math.max(16, maxY - minY);
    const k = Math.max(1, Math.min(18, 0.88 * Math.min((breite - pad * 2) / w, (hoehe - pad * 2) / h)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return zoomIdentity.translate(breite / 2 - cx * k, hoehe / 2 - cy * k).scale(k);
  }

  function sichtbareGeoBox() {
    const ecken = [[0, 0], [breite, 0], [breite, hoehe], [0, hoehe]];
    let minLon = 180;
    let minLat = 90;
    let maxLon = -180;
    let maxLat = -90;
    let treffer = false;
    for (const ecke of ecken) {
      const xy = transform.invert(ecke);
      if (!xy) continue;
      const geo = projektion.invert(xy);
      if (!geo || Number.isNaN(geo[0]) || Number.isNaN(geo[1])) continue;
      treffer = true;
      minLon = Math.min(minLon, geo[0]);
      minLat = Math.min(minLat, geo[1]);
      maxLon = Math.max(maxLon, geo[0]);
      maxLat = Math.max(maxLat, geo[1]);
    }
    if (!treffer) return null;
    const pad = 1.4 / (transform.k || 1);
    return [minLon - pad, minLat - pad, maxLon + pad, maxLat + pad];
  }

  function ringVereinfachen(ring, minDist) {
    if (!ring || ring.length <= 4) return ring;
    const out = [];
    let letzt = null;
    for (let i = 0; i < ring.length; i += 1) {
      const p = projektion(ring[i]);
      if (!p || Number.isNaN(p[0])) continue;
      const ende = i === 0 || i === ring.length - 1;
      if (!letzt || ende || Math.hypot(p[0] - letzt[0], p[1] - letzt[1]) >= minDist) {
        out.push(ring[i]);
        letzt = p;
      }
    }
    if (out.length >= 2) {
      const a = out[0];
      const b = out[out.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
    }
    return out.length >= 4 ? out : ring;
  }

  function landFeinZeichnen() {
    if (!land10Polygone) return;
    const box = sichtbareGeoBox();
    if (!box) return;
    const [minLon, minLat, maxLon, maxLat] = box;
    const k = transform.k || 1;
    const voll = k >= LAND10_VOLL_ZOOM;
    const minDist = voll ? 0 : Math.max(0.9, 2.4 / k);
    const teile = [];
    for (const stueck of land10Polygone) {
      if (stueck.maxLon < minLon || stueck.minLon > maxLon
        || stueck.maxLat < minLat || stueck.minLat > maxLat) continue;
      const rings = voll
        ? stueck.poly
        : stueck.poly.map((ring) => ringVereinfachen(ring, minDist));
      if (!rings[0] || rings[0].length < 4) continue;
      const d = pfad({ type: 'Polygon', coordinates: rings });
      if (d) teile.push(d);
    }
    landFeinGruppe.selectAll('path').remove();
    if (teile.length === 0) return;
    landFeinGruppe.append('path')
      .attr('class', 'land land-fein-fuell')
      .attr('d', teile.join(''));
  }

  function landFeinPruefen() {
    const k = transform.k || 1;
    if (k < LAND10_ZOOM) {
      landFeinGruppe.style('display', 'none');
      grenzGruppe.style('display', 'none');
      landGruppe.style('display', null);
      return;
    }
    if (land10Polygone) {
      landFeinZeichnen();
      landFeinGruppe.style('display', null);
      grenzGruppe.style('display', null);
      landGruppe.style('display', 'none');
      return;
    }
    land10Laden().then((liste) => {
      land10Polygone = liste;
      if ((transform.k || 1) >= LAND10_ZOOM) {
        landFeinZeichnen();
        landFeinGruppe.style('display', null);
        grenzGruppe.style('display', null);
        landGruppe.style('display', 'none');
      }
    }).catch(() => {});
  }

  function nachZoomZeichnen() {
    nadelnNeu();
    beschriftungenZeichnen();
    blasePlatzieren();
    landFeinPruefen();
  }

  function beschriftungenZeichnen() {
    schriftGruppe.selectAll('*').remove();
    stadtGruppe.selectAll('*').remove();
    const k = transform.k || 1;
    const skala = 1 / k;
    const box = sichtbareGeoBox();

    for (const land of laender.features) {
      const name = LAENDER_DE[Number(land.id)];
      if (!name) continue;
      const mitte = geoCentroid(land);
      if (!mitte || Number.isNaN(mitte[0])) continue;
      if (box && (mitte[0] < box[0] || mitte[0] > box[2] || mitte[1] < box[1] || mitte[1] > box[3])) continue;
      const bounds = pfad.bounds(land);
      const breit = (bounds[1][0] - bounds[0][0]) * k;
      const hoch = (bounds[1][1] - bounds[0][1]) * k;
      if (breit < 72 || hoch < 36) continue;
      const pos = xy(mitte[1], mitte[0]);
      if (!pos) continue;
      const g = schriftGruppe.append('g')
        .attr('class', 'karten-label karten-label-land')
        .attr('data-prio', '40')
        .attr('data-x', pos.x)
        .attr('data-y', pos.y)
        .attr('transform', `translate(${pos.x},${pos.y}) scale(${skala})`);
      g.append('text').attr('class', 'karten-landname').text(name);
    }

    for (const meerName of MEERE) {
      if (k < meerName.minK) continue;
      if (box && (meerName.lon < box[0] || meerName.lon > box[2] || meerName.lat < box[1] || meerName.lat > box[3])) continue;
      const pos = xy(meerName.lat, meerName.lon);
      if (!pos) continue;
      const g = schriftGruppe.append('g')
        .attr('class', 'karten-label karten-label-meer')
        .attr('data-prio', '30')
        .attr('data-x', pos.x)
        .attr('data-y', pos.y)
        .attr('transform', `translate(${pos.x},${pos.y}) scale(${skala})`);
      g.append('text').attr('class', 'karten-meername').text(meerName.name);
    }

    const reiseOrte = (trip?.plan || []).filter((e) => e.typ === 'ort' && Number.isFinite(e.lat));
    for (const ort of KARTEN_ORTE) {
      if (k < ort.minK) continue;
      if (box && (ort.lon < box[0] || ort.lon > box[2] || ort.lat < box[1] || ort.lat > box[3])) continue;
      if (stadtDurchNadelAbgedeckt(ort, reiseOrte)) continue;
      const pos = xy(ort.lat, ort.lon);
      if (!pos) continue;
      const g = stadtGruppe.append('g')
        .attr('class', 'karten-label karten-label-stadt')
        .attr('data-prio', '10')
        .attr('data-x', pos.x)
        .attr('data-y', pos.y)
        .attr('transform', `translate(${pos.x},${pos.y}) scale(${skala})`);
      g.append('circle').attr('class', 'karten-stadt-punkt').attr('r', 2.4);
      g.append('text').attr('class', 'karten-stadt-name').attr('x', 6).attr('y', 4).text(ort.name);
    }

    labelsKollision();
  }

  function labelsSkalieren() {
    const skala = 1 / (transform.k || 1);
    const alle = [
      ...schriftGruppe.selectAll('g.karten-label').nodes(),
      ...stadtGruppe.selectAll('g.karten-label').nodes(),
    ];
    for (const node of alle) {
      const x = Number(node.dataset.x);
      const y = Number(node.dataset.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      node.setAttribute('transform', `translate(${x},${y}) scale(${skala})`);
    }
  }

  function labelsKollision() {
    const knoten = [
      ...schriftGruppe.selectAll('g.karten-label').nodes(),
      ...stadtGruppe.selectAll('g.karten-label').nodes(),
    ].map((node) => {
      let box;
      try {
        box = node.getBoundingClientRect();
      } catch {
        box = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
      }
      return {
        node,
        prio: Number(node.dataset.prio) || 0,
        flaeche: box.width * box.height,
        box,
      };
    }).filter((eintrag) => eintrag.box.width > 0);

    const sperren = [...container.querySelectorAll('.nadel-kopf, .nadel-schild')].map((el) => {
      try {
        return el.getBoundingClientRect();
      } catch {
        return null;
      }
    }).filter(Boolean);

    const trifft = (a, b) => !(a.right < b.left + 3 || a.left > b.right - 3
      || a.bottom < b.top + 3 || a.top > b.bottom - 3);

    knoten.sort((a, b) => b.prio - a.prio || b.flaeche - a.flaeche);
    const behalten = [];
    for (const label of knoten) {
      const kollidiertNadel = sperren.some((s) => trifft(label.box, s));
      const kollidiertLabel = behalten.some((anderes) => trifft(label.box, anderes.box));
      if (kollidiertNadel || kollidiertLabel) {
        label.node.style.display = 'none';
      } else {
        behalten.push(label);
      }
    }
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
    const punkte = nadelPunkteSammeln();
    for (const gruppe of nadelGruppen(punkte, CLUSTER_PX)) {
      const x = gruppe.punkte.reduce((s, p) => s + p.x, 0) / gruppe.punkte.length;
      const y = gruppe.punkte.reduce((s, p) => s + p.y, 0) / gruppe.punkte.length;
      const aktuell = gruppe.punkte.some((p) => p.aktuell);
      const besucht = gruppe.punkte.every((p) => p.besucht) && !aktuell;
      const vertreter = gruppe.punkte.find((p) => p.aktuell)
        || gruppe.punkte.slice().sort((a, b) => artPrio(b.eintrag.art) - artPrio(a.eintrag.art))[0];
      const name = gruppe.typ === 'region'
        ? regionNadelName(gruppe)
        : gruppe.typ === 'cluster'
          ? gemeinsamerName(gruppe.punkte.map((p) => p.eintrag.name))
          : nadelKurzname(vertreter.eintrag);
      const innen = marke(nadelGruppe, x, y, 0, 'nadel-innen', 'nadel');
      nadelSymbol(innen, vertreter.eintrag, besucht, aktuell, name, gruppe.typ === 'region');
      innen.style('cursor', 'pointer')
        .attr('role', 'button')
        .attr('tabindex', 0)
        .on('click', (ereignis) => {
          ereignis.sourceEvent?.stopPropagation();
          if (gruppe.typ === 'region') {
            ortKlick?.(gruppe.punkte.map((p) => p.eintrag));
          } else {
            ortKlick?.(vertreter.eintrag);
          }
        });
    }
  }

  function nadelPunkteSammeln() {
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
    return punkte;
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
    else if (art === 'flug') flugZeichnen(flip);
    else if (art === 'roller') rollerZeichnen(flip);
    else if (art === 'bus') busZeichnen(flip);
    else if (art === 'faehre') faehreZeichnen(flip);
    else if (art === 'auto') autoZeichnen(flip);
    else if (art === 'strand') strandLeuteZeichnen(skala, schlaeft());
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
    if (status?.status === 'ort' && status.strand) return 'strand';
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
    beschriftungenZeichnen();
    blaseZeichnen();
  }

  function anpassenUndZurueck() {
    const masse = groesseLesen();
    breite = masse.breite;
    hoehe = masse.hoehe;
    projektionAnpassen();
    szeneNeu();
    svg.call(verhalten.transform, regionTransform());
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
    svg.classed('nacht', istNachtAnPosition(zeit, status, trip?.zeitzone || 'Europe/Berlin'));
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
    zoomGlaettung = true;
    cancelAnimationFrame(animationsRahmen);
    const schritt = (jetzt) => {
      const p = Math.min(1, (jetzt - beginn) / dauer);
      const e = 1 - (1 - p) ** 3;
      const k = start.k + (ziel.k - start.k) * e;
      const x = start.x + (ziel.x - start.x) * e;
      const y = start.y + (ziel.y - start.y) * e;
      svg.call(verhalten.transform, zoomIdentity.translate(x, y).scale(k));
      if (p < 1) animationsRahmen = requestAnimationFrame(schritt);
      else {
        zoomGlaettung = false;
        nachZoomZeichnen();
      }
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

  function zoomPlus() {
    zoomSchritt(ZOOM_SCHRITT);
  }

  function zoomMinus() {
    zoomSchritt(1 / ZOOM_SCHRITT);
  }

  function zoomSchritt(faktor) {
    const mitte = [breite / 2, hoehe / 2];
    svg.transition().duration(280).call(verhalten.scaleBy, faktor, mitte);
  }

  function zerstoeren() {
    cancelAnimationFrame(animationsRahmen);
    clearTimeout(zoomTimer);
    beobachter.disconnect();
    container.replaceChildren();
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (container.isConnected && trip) szeneNeu();
    });
  }

  return {
    aktualisieren,
    ganzeReise,
    woSindWir,
    zoomPlus,
    zoomMinus,
    setzeOrtKlick,
    setzeGrussKlick,
    zerstoeren,
  };
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
  if (modus === 'flug') return 'route route-flug';
  if (modus === 'roller') return 'route route-roller';
  if (modus === 'bus') return 'route route-bus';
  if (modus === 'faehre') return 'route route-faehre';
  if (modus === 'auto') return 'route route-auto';
  return 'route route-grau';
}

function nadelSymbol(innen, ort, besucht, aktuell, anzeigeName, regionNadel = false) {
  if (aktuell) {
    innen.append('circle').attr('class', 'nadel-ring').attr('r', 18);
  }
  innen.append('circle').attr('class', 'nadel-kopf').attr('r', NADEL_RADIUS);
  const symbol = innen.append('g').attr('class', 'nadel-symbol').attr('transform', `scale(${FIGUR_SKALA})`);
  if (regionNadel) {
    symbol.append('text')
      .attr('class', 'nadel-region-symbol')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 12)
      .text('📍');
  } else if (ort.art === 'hotel') bettZeichnen(symbol);
  else if (ort.art === 'hafen') ankerZeichnen(symbol.append('g').attr('transform', 'scale(0.55)'));
  else if (ort.art === 'bahnhof') miniZugZeichnen(symbol);
  else if (ort.art === 'flughafen') miniFlugZeichnen(symbol);
  else if (ort.art === 'rollerverleih') miniRollerZeichnen(symbol);
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
  if (art === 'flughafen') return 3;
  if (art === 'zuhause') return 2;
  if (art === 'rollerverleih') return 2;
  if (art === 'bahnhof') return 1;
  return 0;
}

function istUebernachtung(ort) {
  return ort?.art === 'hotel' || ort?.art === 'zuhause';
}

const ART_EMOJI = {
  hotel: '🏨',
  flughafen: '✈️',
  bahnhof: '🚉',
  hafen: '⚓',
  rollerverleih: '🛵',
  zuhause: '🏠',
};

function regionNadelName(gruppe) {
  const region = gruppe.region || gruppe.punkte[0]?.eintrag?.region || 'Ort';
  const arten = [];
  const gesehen = new Set();
  const sortiert = [...gruppe.punkte].sort((a, b) => artPrio(b.eintrag.art) - artPrio(a.eintrag.art));
  for (const punkt of sortiert) {
    const art = punkt.eintrag.art || '';
    const emoji = ART_EMOJI[art];
    if (!emoji || gesehen.has(art)) continue;
    gesehen.add(art);
    arten.push(emoji);
  }
  return arten.length > 0 ? `${region} ${arten.join('')}` : region;
}

function nadelKurzname(ort) {
  const name = String(ort?.name || '').trim();
  if (ort?.art === 'hotel') {
    return `🏨 ${name.replace(/^Hotel\s+/i, '')}`;
  }
  if (ort?.art === 'flughafen') {
    const klammer = name.match(/\(([^)]+)\)/);
    if (klammer) return `✈️ ${klammer[1].trim()}`;
    return `✈️ ${name.replace(/^Flughafen\s+/i, '')}`;
  }
  if (ort?.art === 'bahnhof') {
    return `🚉 ${name.replace(/^(Bus)?bahnhof\s+/i, '')}`;
  }
  if (ort?.art === 'hafen') return `⚓ ${name}`;
  if (ort?.art === 'rollerverleih') return `🛵 ${name}`;
  if (ort?.art === 'zuhause') return `🏠 ${ort.region || name}`;
  return ort?.region || name;
}

/** Stadt-Label ausblenden, wenn schon eine Nadel derselben Region in ~30 km liegt. */
function stadtDurchNadelAbgedeckt(stadt, reiseOrte) {
  const ziel = String(stadt.name || '').toLowerCase();
  for (const ort of reiseOrte) {
    const region = String(ort.region || '').toLowerCase();
    if (!region || region !== ziel) continue;
    if (distanzKm(stadt, ort) <= 30) return true;
  }
  return false;
}

function distanzKm(a, b) {
  const erde = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * erde * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Regionen als eine Nadel, solange die Stationen näher als maxPx liegen.
 * Ohne region: wie bisher clustern, Hotels/Zuhause bleiben allein.
 */
function nadelGruppen(punkte, maxPx) {
  const mitRegion = new Map();
  const ohneRegion = [];
  for (const punkt of punkte) {
    const region = punkt.eintrag.region;
    if (region) {
      if (!mitRegion.has(region)) mitRegion.set(region, []);
      mitRegion.get(region).push(punkt);
    } else {
      ohneRegion.push(punkt);
    }
  }

  const gruppen = [];
  for (const [region, liste] of mitRegion) {
    if (liste.length === 1 || minBildschirmAbstand(liste) >= maxPx) {
      for (const punkt of liste) {
        gruppen.push({ typ: 'einzeln', punkte: [punkt] });
      }
    } else {
      gruppen.push({ typ: 'region', region, punkte: liste });
    }
  }
  for (const cluster of orteClustern(ohneRegion, maxPx)) {
    gruppen.push({
      typ: cluster.length === 1 ? 'einzeln' : 'cluster',
      punkte: cluster,
    });
  }
  return gruppen;
}

function minBildschirmAbstand(punkte) {
  let min = Infinity;
  for (let i = 0; i < punkte.length; i += 1) {
    for (let j = i + 1; j < punkte.length; j += 1) {
      const dx = punkte[i].sx - punkte[j].sx;
      const dy = punkte[i].sy - punkte[j].sy;
      const d = Math.hypot(dx, dy);
      if (d < min) min = d;
    }
  }
  return min;
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

/** Vereinigt Orte, die auf dem Bildschirm näher als maxPx beieinander liegen.
 *  Übernachtungen (Hotel, Zuhause) bleiben immer eigene Nadeln. */
function orteClustern(punkte, maxPx) {
  if (punkte.length === 0) return [];
  const allein = [];
  const rest = [];
  for (const punkt of punkte) {
    if (istUebernachtung(punkt.eintrag)) allein.push([punkt]);
    else rest.push(punkt);
  }
  if (rest.length === 0) return allein;
  const eltern = rest.map((_, i) => i);
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
  for (let i = 0; i < rest.length; i += 1) {
    for (let j = i + 1; j < rest.length; j += 1) {
      const dx = rest[i].sx - rest[j].sx;
      const dy = rest[i].sy - rest[j].sy;
      if (dx * dx + dy * dy <= grenze) unite(i, j);
    }
  }
  const gruppen = new Map();
  for (let i = 0; i < rest.length; i += 1) {
    const wurzel = find(i);
    if (!gruppen.has(wurzel)) gruppen.set(wurzel, []);
    gruppen.get(wurzel).push(rest[i]);
  }
  return [...allein, ...gruppen.values()];
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
  g.append('rect').attr('class', 'taxi-schild').attr('x', -5).attr('y', -20).attr('width', 10).attr('height', 6).attr('rx', 1);
  g.append('circle').attr('class', 'rad').attr('cx', -14).attr('cy', 14).attr('r', 5);
  g.append('circle').attr('class', 'rad').attr('cx', 16).attr('cy', 14).attr('r', 5);
}

function autoZeichnen(flip) {
  const g = flip.append('g').attr('class', 'pkw');
  g.append('path').attr('class', 'pkw-huelle').attr('d', 'M-28 4 l8 -14 h28 l8 14 v10 h-44 z');
  g.append('rect').attr('class', 'fenster').attr('x', -12).attr('y', -8).attr('width', 16).attr('height', 8).attr('rx', 2);
  g.append('circle').attr('class', 'rad').attr('cx', -14).attr('cy', 14).attr('r', 5);
  g.append('circle').attr('class', 'rad').attr('cx', 16).attr('cy', 14).attr('r', 5);
}

function flugZeichnen(flip) {
  const g = flip.append('g').attr('class', 'flugzeug');
  g.append('path').attr('class', 'kondens').attr('d', 'M-22 1 q-16 -7 -42 1');
  g.append('path').attr('class', 'kondens').attr('d', 'M-20 6 q-14 5 -40 -1');
  g.append('ellipse').attr('class', 'flug-rumpf').attr('cx', 2).attr('cy', 1).attr('rx', 22).attr('ry', 7);
  g.append('path').attr('class', 'flug-fluegel').attr('d', 'M-2 2 l-10 16 h11 l10 -16 z');
  g.append('path').attr('class', 'flug-fluegel').attr('d', 'M0 0 l-8 -14 h9 l8 14 z');
  g.append('path').attr('class', 'flug-leit').attr('d', 'M-16 -1 l-5 -11 h7 l5 11 z');
  g.append('circle').attr('class', 'fenster').attr('cx', 12).attr('cy', 0).attr('r', 2.1);
  g.append('circle').attr('class', 'fenster').attr('cx', 5).attr('cy', 0).attr('r', 2.1);
  g.append('circle').attr('class', 'fenster').attr('cx', -2).attr('cy', 0).attr('r', 2.1);
  g.append('circle').attr('class', 'flug-licht flug-licht-rot').attr('cx', -10).attr('cy', 16).attr('r', 2.3);
  g.append('circle').attr('class', 'flug-licht flug-licht-gruen').attr('cx', -6).attr('cy', -13).attr('r', 2.3);
  g.append('circle').attr('class', 'flug-licht flug-licht-weiss').attr('cx', 22).attr('cy', 1).attr('r', 1.8);
}

function rollerZeichnen(flip) {
  const g = flip.append('g').attr('class', 'roller');
  const wackeln = g.append('g').attr('class', 'roller-wackeln');
  wackeln.append('circle').attr('class', 'rad').attr('cx', -16).attr('cy', 12).attr('r', 6);
  wackeln.append('circle').attr('class', 'rad').attr('cx', 18).attr('cy', 12).attr('r', 6);
  wackeln.append('path').attr('class', 'roller-tritt').attr('d', 'M-16 6 h22 q6 0 8 6');
  wackeln.append('path').attr('class', 'roller-lenker').attr('d', 'M18 6 l8 -14 h6');
  wackeln.append('ellipse').attr('class', 'roller-sitz').attr('cx', 2).attr('cy', 2).attr('rx', 12).attr('ry', 4);
  const vorn = wackeln.append('g').attr('transform', 'translate(6,-6) scale(0.72)');
  person(vorn, 0, 1);
  helm(vorn, 0, -20);
  const hinten = wackeln.append('g').attr('transform', 'translate(-10,-4) scale(0.68)');
  person(hinten, 0, 1);
  helm(hinten, 0, -20);
}

function helm(g, x, y) {
  g.append('path')
    .attr('class', 'helm')
    .attr('d', `M${x - 7} ${y + 2} q0 -12 7 -12 q7 0 7 12`);
  g.append('path')
    .attr('class', 'helm-visier')
    .attr('d', `M${x - 5} ${y + 1} h10`);
}

function busZeichnen(flip) {
  const g = flip.append('g').attr('class', 'reisebus');
  g.append('rect').attr('class', 'bus-huelle').attr('x', -34).attr('y', -16).attr('width', 68).attr('height', 28).attr('rx', 10);
  g.append('rect').attr('class', 'bus-front').attr('x', 22).attr('y', -10).attr('width', 12).attr('height', 16).attr('rx', 3);
  g.append('rect').attr('class', 'fenster').attr('x', -26).attr('y', -10).attr('width', 12).attr('height', 9).attr('rx', 2);
  g.append('rect').attr('class', 'fenster').attr('x', -10).attr('y', -10).attr('width', 12).attr('height', 9).attr('rx', 2);
  g.append('rect').attr('class', 'fenster').attr('x', 6).attr('y', -10).attr('width', 12).attr('height', 9).attr('rx', 2);
  g.append('circle').attr('class', 'rad').attr('cx', -18).attr('cy', 14).attr('r', 5);
  g.append('circle').attr('class', 'rad').attr('cx', 16).attr('cy', 14).attr('r', 5);
  g.append('circle').attr('class', 'bus-licht').attr('cx', 32).attr('cy', 4).attr('r', 2);
}

function faehreZeichnen(flip) {
  const g = flip.append('g').attr('class', 'autofaehre');
  g.append('path').attr('class', 'kielwasser').attr('d', 'M-36 12 q10 -6 20 0 t20 0');
  const koerper = g.append('g').attr('class', 'faehre-koerper');
  koerper.append('path').attr('class', 'faehre-rumpf').attr('d', 'M-32 8 q4 10 32 10 q28 0 32 -10 l-6 -8 h-52 z');
  koerper.append('rect').attr('class', 'faehre-deck').attr('x', -22).attr('y', -10).attr('width', 40).attr('height', 14).attr('rx', 3);
  koerper.append('rect').attr('class', 'fenster').attr('x', -16).attr('y', -6).attr('width', 8).attr('height', 6).attr('rx', 1);
  koerper.append('rect').attr('class', 'fenster').attr('x', -4).attr('y', -6).attr('width', 8).attr('height', 6).attr('rx', 1);
  koerper.append('rect').attr('class', 'fenster').attr('x', 8).attr('y', -6).attr('width', 8).attr('height', 6).attr('rx', 1);
  koerper.append('rect').attr('class', 'pkw-huelle').attr('x', -8).attr('y', -18).attr('width', 16).attr('height', 8).attr('rx', 2);
}

function strandLeuteZeichnen(innen, schlafend) {
  const g = innen.append('g').attr('class', schlafend ? 'strand-leute leute-schlaf' : 'strand-leute');
  const palme = g.append('g').attr('class', 'palme').attr('transform', 'translate(-26,-8)');
  palme.append('path').attr('class', 'stamm').attr('d', 'M0 18 q-2 -12 0 -28');
  palme.append('path').attr('class', 'blatt').attr('d', 'M0 -10 q-16 -10 -20 2');
  palme.append('path').attr('class', 'blatt').attr('d', 'M0 -10 q-4 -16 10 -18');
  palme.append('path').attr('class', 'blatt').attr('d', 'M0 -10 q14 -8 18 4');
  const stuhl = (x) => {
    const s = g.append('g').attr('transform', `translate(${x},8)`);
    s.append('path').attr('class', 'liege').attr('d', 'M-14 4 l18 -10 h12 l-4 12 h-26 z');
    s.append('path').attr('class', 'liege-bein').attr('d', 'M-10 4 v6 M10 6 v4');
  };
  stuhl(-4);
  stuhl(22);
  if (schlafend) {
    g.append('circle').attr('class', 'haut').attr('cx', -2).attr('cy', 2).attr('r', 5);
    g.append('rect').attr('class', 'kleid').attr('x', 2).attr('y', -2).attr('width', 16).attr('height', 8).attr('rx', 3);
    g.append('circle').attr('class', 'haut').attr('cx', 22).attr('cy', 0).attr('r', 4.5);
    g.append('rect').attr('class', 'kleid').attr('x', 26).attr('y', -4).attr('width', 14).attr('height', 7).attr('rx', 3);
    g.append('text').attr('class', 'zzz zzz-sichtbar').attr('x', 18).attr('y', -22).text('Zzz');
    return;
  }
  person(g.append('g').attr('transform', 'translate(-6,-2) scale(0.72)'), 0, 1);
  person(g.append('g').attr('transform', 'translate(18,-4) scale(0.66)'), 0, 1);
}

function miniFlugZeichnen(g) {
  g.append('ellipse').attr('class', 'mini-flug').attr('cx', 1).attr('cy', 0).attr('rx', 10).attr('ry', 3.5);
  g.append('path').attr('class', 'mini-flug').attr('d', 'M-2 0 l-6 8 h5 l6 -8 z');
  g.append('path').attr('class', 'mini-flug').attr('d', 'M-6 0 l-3 -7 h4 l3 7 z');
}

function miniRollerZeichnen(g) {
  g.append('circle').attr('class', 'rad').attr('cx', -6).attr('cy', 5).attr('r', 2.4);
  g.append('circle').attr('class', 'rad').attr('cx', 6).attr('cy', 5).attr('r', 2.4);
  g.append('path').attr('class', 'mini-roller').attr('d', 'M-6 3 h8 q3 0 4 3 M10 3 l3 -6');
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
