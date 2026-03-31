// ════════════════════════════════════════════════════════════
// Perth Suburb Wind Zone Lookup — per AS 4055
//
// N2 = Wind Region A, Terrain Cat 2 (inland Perth)
// N3 = Wind Region A, Terrain Cat 3 (coastal/exposed)
// ════════════════════════════════════════════════════════════

export type WindZone = 'N1' | 'N2' | 'N3' | 'N4' | 'C1' | 'C2';

export interface WindZoneRequirement {
  zone: WindZone;
  windSpeed: string;
  description: string;
  maxRafterSpan?: number;
  postSize?: string;
  bracingRequired?: boolean;
}

// Coastal/exposed suburbs → N3
const N3_SUBURBS: string[] = [
  'scarborough', 'fremantle', 'north fremantle', 'south fremantle',
  'cottesloe', 'swanbourne', 'city beach', 'floreat',
  'hillarys', 'sorrento', 'watermans bay', 'marmion',
  'trigg', 'karrinyup', 'doubleview',
  'yanchep', 'two rocks', 'lancelin',
  'rockingham', 'safety bay', 'shoalwater', 'waikiki', 'port kennedy',
  'mandurah', 'halls head', 'falcon', 'dawesville',
  'burns beach', 'mindarie', 'clarkson', 'butler',
  'ocean reef', 'mullaloo', 'kallaroo',
  'coogee', 'munster', 'henderson', 'naval base',
  'secret harbour', 'golden bay', 'singleton',
];

// Inland suburbs → N2 (default for Perth metro)
const N2_SUBURBS: string[] = [
  'joondalup', 'wanneroo', 'ellenbrook', 'the vines',
  'midland', 'guildford', 'helena valley', 'mundijong',
  'armadale', 'byford', 'serpentine', 'jarrahdale',
  'canning vale', 'willetton', 'riverton', 'bull creek',
  'baldivis', 'wellard', 'bertram',
  'gosnells', 'maddington', 'kenwick', 'thornlie',
  'morley', 'bayswater', 'bassendean', 'ashfield',
  'victoria park', 'south perth', 'como', 'manning',
  'perth', 'northbridge', 'east perth', 'west perth',
  'subiaco', 'nedlands', 'claremont', 'dalkeith',
  'osborne park', 'innaloo', 'stirling', 'balcatta',
  'wangara', 'malaga', 'landsdale', 'darch',
  'high wycombe', 'forrestfield', 'kalamunda', 'lesmurdie',
  'mundaring', 'glen forrest', 'darlington',
  'piara waters', 'harrisdale', 'southern river',
  'success', 'atwell', 'aubin grove', 'treeby',
  'cockburn central', 'bibra lake', 'yangebup',
];

export const WIND_ZONE_REQUIREMENTS: Record<WindZone, WindZoneRequirement> = {
  N1: {
    zone: 'N1',
    windSpeed: 'W28N — 100 km/h',
    description: 'Non-cyclonic, sheltered inland',
  },
  N2: {
    zone: 'N2',
    windSpeed: 'W33N — 120 km/h',
    description: 'Non-cyclonic, standard inland Perth',
    maxRafterSpan: 6000,
    postSize: '90x90 SHS or 100x100 timber',
    bracingRequired: false,
  },
  N3: {
    zone: 'N3',
    windSpeed: 'W41N — 150 km/h',
    description: 'Non-cyclonic, coastal/exposed Perth',
    maxRafterSpan: 5000,
    postSize: '100x100 SHS minimum',
    bracingRequired: true,
  },
  N4: {
    zone: 'N4',
    windSpeed: 'W50N — 180 km/h',
    description: 'Non-cyclonic, severe exposure',
    bracingRequired: true,
  },
  C1: {
    zone: 'C1',
    windSpeed: 'W50C — 180 km/h',
    description: 'Cyclonic Region B (north of Perth)',
    bracingRequired: true,
  },
  C2: {
    zone: 'C2',
    windSpeed: 'W60C — 216 km/h',
    description: 'Cyclonic Region A (far north WA)',
    bracingRequired: true,
  },
};

/**
 * Get the wind zone for a Perth suburb.
 * Returns N3 for coastal, N2 for inland, N2 as default.
 */
export function getWindZoneForSuburb(suburb: string): WindZone {
  const normalised = suburb.toLowerCase().trim();

  if (N3_SUBURBS.includes(normalised)) return 'N3';
  if (N2_SUBURBS.includes(normalised)) return 'N2';

  // Fuzzy check — partial match
  if (N3_SUBURBS.some((s) => normalised.includes(s) || s.includes(normalised))) return 'N3';
  if (N2_SUBURBS.some((s) => normalised.includes(s) || s.includes(normalised))) return 'N2';

  return getDefaultWindZone();
}

/**
 * Default wind zone for unknown Perth suburbs.
 */
export function getDefaultWindZone(): WindZone {
  return 'N2'; // Safe default for Perth metro
}
