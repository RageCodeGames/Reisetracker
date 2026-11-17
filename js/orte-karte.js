/**
 * Feste Namen und Orte für die Comic-Karte.
 * Alles lokal, keine Kacheln und kein Netz.
 */

/** ISO-3166-Zahlen aus world-atlas → deutscher Name. */
export const LAENDER_DE = {
  40: 'Österreich',
  56: 'Belgien',
  76: 'Brasilien',
  104: 'Myanmar',
  116: 'Kambodscha',
  156: 'China',
  208: 'Dänemark',
  246: 'Finnland',
  250: 'Frankreich',
  276: 'Deutschland',
  300: 'Griechenland',
  344: 'Hongkong',
  356: 'Indien',
  360: 'Indonesien',
  372: 'Irland',
  380: 'Italien',
  392: 'Japan',
  398: 'Kasachstan',
  410: 'Südkorea',
  418: 'Laos',
  428: 'Lettland',
  440: 'Litauen',
  442: 'Luxemburg',
  458: 'Malaysia',
  528: 'Niederlande',
  578: 'Norwegen',
  608: 'Philippinen',
  616: 'Polen',
  620: 'Portugal',
  642: 'Rumänien',
  643: 'Russland',
  702: 'Singapur',
  703: 'Slowakei',
  704: 'Vietnam',
  710: 'Südafrika',
  724: 'Spanien',
  752: 'Schweden',
  756: 'Schweiz',
  764: 'Thailand',
  784: 'VAE',
  792: 'Türkei',
  804: 'Ukraine',
  826: 'Großbritannien',
  840: 'USA',
};

/** Meeresnamen, grob in der Mitte der Wasserfläche. */
export const MEERE = [
  { name: 'Nordsee', lat: 56.2, lon: 3.4, minK: 1.15 },
  { name: 'Ostsee', lat: 56.6, lon: 18.4, minK: 1.3 },
  { name: 'Skagerrak', lat: 58.0, lon: 8.8, minK: 2.2 },
  { name: 'Andamanensee', lat: 11.2, lon: 96.0, minK: 2.8 },
  { name: 'Golf von Thailand', lat: 9.4, lon: 101.9, minK: 3.2 },
  { name: 'Südchinesisches Meer', lat: 12.5, lon: 113.2, minK: 2.4 },
  { name: 'Indischer Ozean', lat: 2.2, lon: 88.5, minK: 1.4 },
];

/**
 * Städte und Inseln. minK: sichtbar ab diesem Zoom
 * (1 = ganze Reise München–Thailand).
 */
export const KARTEN_ORTE = [
  { name: 'Bangkok', lat: 13.7563, lon: 100.5018, minK: 3.4 },
  { name: 'Chiang Mai', lat: 18.7883, lon: 98.9853, minK: 3.6 },
  { name: 'Chiang Rai', lat: 19.9105, lon: 99.8406, minK: 5.5 },
  { name: 'Ayutthaya', lat: 14.3692, lon: 100.5877, minK: 6.5 },
  { name: 'Phuket', lat: 7.8804, lon: 98.3923, minK: 5.0 },
  { name: 'Krabi', lat: 8.0863, lon: 98.9063, minK: 5.5 },
  { name: 'Koh Lanta', lat: 7.624, lon: 99.078, minK: 7.0 },
  { name: 'Koh Phi Phi', lat: 7.7407, lon: 98.7784, minK: 7.2 },
  { name: 'Koh Samui', lat: 9.512, lon: 100.013, minK: 5.2 },
  { name: 'Koh Phangan', lat: 9.73, lon: 100.013, minK: 7.0 },
  { name: 'Koh Tao', lat: 10.095, lon: 99.838, minK: 7.4 },
  { name: 'Surat Thani', lat: 9.1382, lon: 99.333, minK: 5.8 },
  { name: 'Hua Hin', lat: 12.5706, lon: 99.958, minK: 6.2 },
  { name: 'Pattaya', lat: 12.9236, lon: 100.8825, minK: 6.0 },
  { name: 'Kuala Lumpur', lat: 3.139, lon: 101.6869, minK: 3.8 },
  { name: 'Vientiane', lat: 17.9757, lon: 102.6331, minK: 4.5 },
  { name: 'Phnom Penh', lat: 11.5564, lon: 104.9282, minK: 4.5 },
  { name: 'Yangon', lat: 16.8409, lon: 96.1735, minK: 4.2 },
  { name: 'Hamburg', lat: 53.5511, lon: 9.9937, minK: 2.4 },
  { name: 'München', lat: 48.1351, lon: 11.582, minK: 2.2 },
  { name: 'Oslo', lat: 59.9139, lon: 10.7522, minK: 2.3 },
  { name: 'Bergen', lat: 60.3913, lon: 5.3221, minK: 2.6 },
  { name: 'Kopenhagen', lat: 55.6761, lon: 12.5683, minK: 2.4 },
];
