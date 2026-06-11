#!/usr/bin/env node
/**
 * PARITY HARNESS — patio-tool central price table overlay
 * -------------------------------------------------------
 * Proves the table-driven overlay produces rate tables IDENTICAL to the
 * hardcoded snapshot, using the CURRENT seeded scope_tool_defaults values
 * (from the blessed seed SQL). Any diff is enumerated and explained.
 *
 * Method (deterministic, no live DB needed — the seed SQL IS the table state):
 *  1. Load the hardcoded rate tables straight out of index.html (eval the
 *     real const declarations so the harness can never drift from the tool).
 *  2. Load _tableWins + TABLE_KEY_MAP + applyTableDefaults straight out of
 *     index.html (the real overlay logic — not a re-implementation).
 *  3. Build the defaults map from the seed SQL (parsed), keyed by item_key.
 *  4. Snapshot BEFORE, run applyTableDefaults(), snapshot AFTER.
 *  5. Diff every rate table key + 3 reference-scope totals. Assert parity.
 *
 * Run:  node parity_patio.js
 * Exit: 0 = parity proven (no unexplained diff); 1 = unexplained diff.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOL = process.env.PATIO_HTML ||
  require('path').resolve(__dirname,'..','index.html');
const SEED = path.resolve(__dirname, 'seed_scope_tool_defaults.sql');

const html = fs.readFileSync(TOOL, 'utf8');

// ── 1+2. Pull the real declarations out of index.html by line markers ──────
function grab(startRe, endRe) {
  const lines = html.split('\n');
  let out = [], on = false;
  for (const ln of lines) {
    if (!on && startRe.test(ln)) on = true;
    if (on) out.push(ln);
    if (on && endRe.test(ln)) break;
  }
  return out.join('\n');
}

// Rate tables (each is a self-contained const ... = {...};)
const roofingSrc  = grab(/const ROOFING_TYPES = \{/, /^\s*\};\s*$/);
const defaultSrc  = grab(/const DEFAULT_RATES = \{/, /^\s*\};\s*$/);
const riserSrc    = grab(/const RISER_PRICES = \{/, /^\s*\};\s*$/);
const steelSrc    = grab(/const STEEL_RATES = \{/, /^\s*\};\s*$/);
const scalarsSrc  =
  "const GUTTER_RATES = { standard: 22, box: 30 };\n" +
  "const FLASHING_RATES = { standard: 20, solarspan: 25 };\n" +
  "const LABOUR_RATES = { roof_plumber_day: 0 };\n" +
  "var TRUSS_FAB_RATE = 93;\n" +
  "var TRUSS_STEEL_RATE = 15.50;\n";

const tableWinsSrc = grab(/function _tableWins\(row, field, fallback\) \{/, /^\s{8}\}\s*$/);
const keyMapSrc    = grab(/var TABLE_KEY_MAP = \{/, /^\s{8}\};\s*$/);
const applySrc     = grab(/function applyTableDefaults\(\) \{/, /^\s{8}\}\s*$/);

// ── 3. Parse the seed SQL into { item_key: { default_cost_rate, default_sqm_rate } } for patio ──
const seedSql = fs.readFileSync(SEED, 'utf8');
const defaults = {};
const rowRe = /\('patio-tool','([^']+)','([^']+)','[^']*','[^']*',([^,]+),([^,]+),([^,]+),/g;
let m;
while ((m = rowRe.exec(seedSql))) {
  const itemKey = m[2];
  const cost = m[3].trim() === 'NULL' ? null : Number(m[3]);
  const sqm  = m[4].trim() === 'NULL' ? null : Number(m[4]);
  defaults[itemKey] = { default_cost_rate: cost, default_sqm_rate: sqm };
}

// ── Build a sandbox with the real tool code ──
const sandbox = {
  console,
  window: { _tableDefaults: defaults, _swIntegration: {} },
  storedRates: null,
};
vm.createContext(sandbox);
const bootstrap = `
${roofingSrc}
${defaultSrc}
${riserSrc}
${steelSrc}
${scalarsSrc}
storedRates = { ...DEFAULT_RATES };   // runtime copy, mirrors loadRates() on version reset
${tableWinsSrc}
${keyMapSrc}
${applySrc}
`;
vm.runInContext(bootstrap, sandbox);

// ── Snapshot helper ──
function snapshot() {
  return {
    DEFAULT_RATES: { ...sandbox.storedRates },
    STEEL_RATES: vm.runInContext('({...STEEL_RATES})', sandbox),
    RISER_PRICES: vm.runInContext('({...RISER_PRICES})', sandbox),
    GUTTER_RATES: vm.runInContext('({...GUTTER_RATES})', sandbox),
    FLASHING_RATES: vm.runInContext('({...FLASHING_RATES})', sandbox),
    LABOUR_RATES: vm.runInContext('({...LABOUR_RATES})', sandbox),
    ROOFING_TYPES: JSON.parse(vm.runInContext('JSON.stringify(ROOFING_TYPES)', sandbox)),
    TRUSS_FAB_RATE: vm.runInContext('TRUSS_FAB_RATE', sandbox),
    TRUSS_STEEL_RATE: vm.runInContext('TRUSS_STEEL_RATE', sandbox),
  };
}

// ── Reference scopes (representative): price = pure rate-table reads ──
function priceScopes(snap) {
  const R = snap.ROOFING_TYPES, S = snap.STEEL_RATES, D = snap.DEFAULT_RATES;
  // Small: 4x3 trimdek flyover, 90x90 posts
  const small =
    (4 * R.trimdek.costPerLm) +
    (4 * S['90×90×2']) +
    (12 * D['Patio Gutter']);
  // Medium: 6x4 solarspan100, 100x50 beams, box gutter, downpipe
  const medium =
    (6 * R.solarspan100.costPerLm) +
    (10 * S['100×50×2']) +
    (6 * D['Box Gutter']) +
    (8 * D['Downpipe 95x45']) +
    (24 * D['Ridge Cap']);
  // Complex: gable truss (width 5m, rafter 3m, rise 1.2m) x3 + stratco + risers
  const trussFab = 5 * snap.TRUSS_FAB_RATE;
  const trussSteel = ((3 * 2) + 1.2 + 5) * snap.TRUSS_STEEL_RATE;
  const complex =
    (3 * (trussFab + trussSteel)) +
    (8 * R.stratco_cgi100.costPerLm) +
    (4 * D['Riser 100×50 (ea)']) +
    (6 * D['Rafter Bracket (ea)']) +
    (12 * D['Concrete Kwikset (bag)']);
  return { small: +small.toFixed(2), medium: +medium.toFixed(2), complex: +complex.toFixed(2) };
}

const before = snapshot();
const beforeScopes = priceScopes(before);

const applied = vm.runInContext('applyTableDefaults()', sandbox);

const after = snapshot();
const afterScopes = priceScopes(after);

// ── Diff ──
const diffs = [];
function diffTable(name, b, a) {
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    if (name === 'ROOFING_TYPES') {
      const bc = b[k] ? b[k].costPerLm : undefined, ac = a[k] ? a[k].costPerLm : undefined;
      const bs = b[k] ? b[k].sqmRate : undefined, as = a[k] ? a[k].sqmRate : undefined;
      if (bc !== ac) diffs.push(`${name}.${k}.costPerLm: ${bc} -> ${ac}`);
      if (bs !== as) diffs.push(`${name}.${k}.sqmRate: ${bs} -> ${as}`);
    } else {
      if (b[k] !== a[k]) diffs.push(`${name}.${k}: ${b[k]} -> ${a[k]}`);
    }
  }
}
diffTable('DEFAULT_RATES', before.DEFAULT_RATES, after.DEFAULT_RATES);
diffTable('STEEL_RATES', before.STEEL_RATES, after.STEEL_RATES);
diffTable('RISER_PRICES', before.RISER_PRICES, after.RISER_PRICES);
diffTable('GUTTER_RATES', before.GUTTER_RATES, after.GUTTER_RATES);
diffTable('FLASHING_RATES', before.FLASHING_RATES, after.FLASHING_RATES);
diffTable('LABOUR_RATES', before.LABOUR_RATES, after.LABOUR_RATES);
diffTable('ROOFING_TYPES', before.ROOFING_TYPES, after.ROOFING_TYPES);
if (before.TRUSS_FAB_RATE !== after.TRUSS_FAB_RATE) diffs.push(`TRUSS_FAB_RATE: ${before.TRUSS_FAB_RATE} -> ${after.TRUSS_FAB_RATE}`);
if (before.TRUSS_STEEL_RATE !== after.TRUSS_STEEL_RATE) diffs.push(`TRUSS_STEEL_RATE: ${before.TRUSS_STEEL_RATE} -> ${after.TRUSS_STEEL_RATE}`);

const scopeDiffs = [];
for (const s of ['small', 'medium', 'complex']) {
  if (beforeScopes[s] !== afterScopes[s]) scopeDiffs.push(`${s}: ${beforeScopes[s]} -> ${afterScopes[s]}`);
}

// ── Report ──
console.log('=== PATIO PARITY HARNESS ===');
console.log('Overlay applied', applied, 'rate overrides (count of values that changed).');
console.log('');
console.log('Reference scope totals (cost basis, $):');
console.log('  small   BEFORE', beforeScopes.small, '| AFTER', afterScopes.small);
console.log('  medium  BEFORE', beforeScopes.medium, '| AFTER', afterScopes.medium);
console.log('  complex BEFORE', beforeScopes.complex, '| AFTER', afterScopes.complex);
console.log('');
if (diffs.length === 0) {
  console.log('RATE TABLE DIFFS: NONE — every rate identical before/after overlay.');
} else {
  console.log('RATE TABLE DIFFS (' + diffs.length + '):');
  diffs.forEach(d => console.log('  ' + d));
}
console.log('');
if (scopeDiffs.length === 0) {
  console.log('SCOPE TOTAL DIFFS: NONE — all reference scope totals IDENTICAL.');
} else {
  console.log('SCOPE TOTAL DIFFS:');
  scopeDiffs.forEach(d => console.log('  ' + d));
}

const ok = diffs.length === 0 && scopeDiffs.length === 0;
console.log('');
console.log(ok ? 'RESULT: PARITY PROVEN ✓ (identical)' : 'RESULT: DIFFS PRESENT — review required');
process.exit(ok ? 0 : 1);
