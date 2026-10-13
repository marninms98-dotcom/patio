#!/usr/bin/env node
/**
 * Regression coverage for LABOUR / MATERIAL scope items (work-order step 1).
 *
 * The bug: an extra line such as "Root removal" was money with no kind and no
 * hours. Its cost landed in the materials figure, and the trade's work order
 * showed nothing (or "1 job") instead of how many hours to spend on it.
 *
 * The fix (index.html):
 *   • every scope-item (extrasRows) row is Labour or Material — every preset starts
 *     unclassified and validatePricing() blocks the send until the scoper picks;
 *   • a Labour row is priced from hours (qty = hours, unitCost = $/hr), and its
 *     cost counts in labourCostEstimate, not materialCostEstimate;
 *   • pricing_json.line_items carry kind (+ hours, cost_per_hour on labour);
 *   • the Work Order PDF lists every labour task with its hours, no dollars;
 *   • rows saved before `kind` existed stay material, so old quotes price the same.
 *
 * The functions are cut out of index.html by name and run — the pure helpers
 * directly, the DOM-bound pricing functions in a sandbox with stubbed inputs.
 *
 * Run: node tools/shared/scope-labour-lines.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '../..');
var SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

var failed = 0, passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.error('  FAIL — ' + msg); }
}

// Cut `function name(...) { ... }` out of the source by brace matching.
function extractFunction(name) {
  var start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function ' + name + ' not found in index.html');
  var open = SRC.indexOf('{', start);
  var depth = 0;
  for (var i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

var helpers = ['extraRowKind', 'extraRowIsBlank', 'extraLabourSummary', 'extrasCountForJobType', 'buildWorkOrderLabourTasks'];
var api = new Function(helpers.map(extractFunction).join('\n') + '\nreturn {' + helpers.join(',') + '};')();

// ── 1. Kind resolution: explicit, unset, and legacy rows ───────────────────
console.log('\n1. A scope item is Labour, Material, or unclassified — legacy rows stay Material');
{
  assert(api.extraRowKind({ kind: 'labour' }) === 'labour', 'kind "labour" reads as labour');
  assert(api.extraRowKind({ kind: 'material' }) === 'material', 'kind "material" reads as material');
  assert(api.extraRowKind({ kind: null }) === null, 'kind null (new + Custom row) reads as unclassified');
  assert(api.extraRowKind({ desc: 'Soakwell', qty: 1, unitCost: 800, unitSell: 1080 }) === 'material',
    'a row saved before `kind` existed reads as material (old quotes unchanged)');
  // JSON round-trip (save → load) keeps null distinct from missing.
  var rt = JSON.parse(JSON.stringify([{ kind: null }, { desc: 'old' }]));
  assert(api.extraRowKind(rt[0]) === null && api.extraRowKind(rt[1]) === 'material',
    'save/load round-trip keeps an unclassified row unclassified and a legacy row material');
}

// ── 2. Labour summary: hours × $/hr, only labour rows ─────────────────────
console.log('\n2. Labour-kind rows sum hours and cost; material and legacy rows do not');
{
  var rows = [
    { desc: 'Root removal', kind: 'labour', unit: 'hrs', qty: 2, unitCost: 45, unitSell: 110 },
    { desc: 'Soakwell', kind: 'material', qty: 1, unitCost: 800, unitSell: 1080 },
    { desc: 'Legacy demo', qty: 1, unitCost: 500, unitSell: 675 },
    { desc: '', kind: 'labour', unit: 'hrs', qty: 1.5, unitCost: 40, unitSell: 100 },
    { desc: 'Not chosen', kind: null, qty: 1, unitCost: 0, unitSell: 0 }
  ];
  var s = api.extraLabourSummary(rows);
  assert(s.hours === 3.5, 'hours = 2 + 1.5 = 3.5 (got ' + s.hours + ')');
  assert(s.cost === 2 * 45 + 1.5 * 40, 'cost = 2×$45 + 1.5×$40 = $150 (got ' + s.cost + ')');
  assert(s.sell === 2 * 110 + 1.5 * 100, 'sell = 2×$110 + 1.5×$100 = $370 (got ' + s.sell + ')');
  assert(s.tasks.length === 2 && s.tasks[0].task === 'Root removal' && s.tasks[0].hours === 2,
    'one task per labour row, named from the description, with its hours');
  assert(s.tasks[1].task === 'Extra labour', 'a labour row with no description is named "Extra labour"');
  var legacy = api.extraLabourSummary([{ desc: 'a', qty: 3, unitCost: 100, unitSell: 150 }]);
  assert(legacy.hours === 0 && legacy.cost === 0 && legacy.tasks.length === 0,
    'legacy (kind-less) rows add nothing to labour — their cost stays in materials as before');
}

// ── 3. Work-order labour tasks: hours only, gated by job type ─────────────
console.log('\n3. The work order lists each labour task with hours and no dollars');
{
  var lab = { trades: 2, labourers: 1, days: 1.5, hoursPerDay: 8, cost: 1500, sell: 3600 };
  var rows = [
    { desc: 'Root removal', kind: 'labour', qty: 2, unitCost: 45, unitSell: 110 },
    { desc: 'Soakwell', kind: 'material', qty: 1, unitCost: 800, unitSell: 1080 }
  ];
  var wo = api.buildWorkOrderLabourTasks(lab, rows, 'full');
  assert(wo.tasks.length === 3, 'full job: trades + labourers + Root removal = 3 tasks (got ' + wo.tasks.length + ')');
  assert(wo.tasks[0].hours === 24 && /2 trades × 1\.5 days × 8 hrs\/day/.test(wo.tasks[0].detail),
    'trades task = 2 × 1.5 × 8 = 24 hrs with its working shown');
  assert(wo.tasks[1].hours === 12, 'labourers task = 1 × 1.5 × 8 = 12 hrs');
  assert(wo.tasks[2].task === 'Root removal' && wo.tasks[2].hours === 2, 'Root removal shows 2 hrs (not "1 job")');
  assert(wo.totalHours === 38, 'total = 24 + 12 + 2 = 38 hrs');
  var text = JSON.stringify(wo);
  assert(text.indexOf('$') < 0 && text.indexOf('45') < 0 && text.indexOf('110') < 0 && text.indexOf('1500') < 0,
    'no dollar amount or rate reaches the work-order task list');
  assert(Object.keys(wo.tasks[2]).sort().join(',') === 'detail,hours,task', 'a task carries only task, detail, hours');

  var custom = api.buildWorkOrderLabourTasks(lab, rows, 'custom');
  assert(custom.tasks.length === 2, 'Custom job: scope items are replaced by custom lines, so no extra labour task');
  var qo = api.buildWorkOrderLabourTasks(lab, rows, 'quote_only');
  assert(qo.tasks.length === 0 && qo.totalHours === 0, 'Quote-only job: no labour card, no extras → no tasks');
  var noLab = api.buildWorkOrderLabourTasks({ trades: 0, labourers: 0, days: 1, hoursPerDay: 8 }, [], 'full');
  assert(noLab.tasks.length === 0, 'zero trades and no labour lines → empty list (PDF prints the "check with office" note)');
}

// ── 4. Blank rows are skipped by validation ───────────────────────────────
console.log('\n4. Blank rows are not flagged');
{
  assert(api.extraRowIsBlank({ desc: '', kind: null, qty: 1, unitCost: 0, unitSell: 0 }), 'an untouched + Custom row is blank');
  assert(!api.extraRowIsBlank({ desc: 'Root removal', kind: null, qty: 1, unitCost: 0, unitSell: 0 }), 'a described row is not blank');
  assert(!api.extraRowIsBlank({ desc: '', kind: 'labour', qty: 2, unitCost: 45, unitSell: 0 }), 'a priced row is not blank');
}

// ── 5. The real pricing functions, run against stubbed DOM/state ─────────
// addExtra, validatePricing, computeJobTotals and buildPricingJson are cut out
// of index.html and run in a sandbox whose DOM is a map of input values.
function makeApp(opts) {
  var values = Object.assign({
    inJobType: 'full', labTrades: '2', labLabourers: '0', labDays: '1',
    settingsHoursPerDay: '8', settingsTradesCostHr: '45', settingsTradesSellHr: '110',
    settingsLabourerCostHr: '35', settingsLabourerSellHr: '90'
  }, (opts && opts.inputs) || {});
  var sb = {
    document: { getElementById: function(id) { return id in values ? { value: values[id] } : null; } },
    calc: { nPosts: 4, connection: 'attached', L: 6000, W: 4000 },
    sheetColor: null,
    jobRows: (opts && opts.jobRows) || [],
    additionalMaterials: [],
    extrasRows: (opts && opts.extrasRows) || [],
    pricingMissingRates: [], LABOUR_RATES: {}, pricingState: {}, pricingValidationState: null,
    REVERSE_SKILLION_UPLIFT_APPLIES: false,
    calculateDemoCost: function() { return 0; },
    getSettingsDefaults: function() { return { markup: 35 }; },
    logScopeDecision: function() {}, renderExtras: function() {}, updatePricing: function() {},
    console: console
  };
  sb.window = sb;
  var vm = require('vm');
  vm.createContext(sb);
  var fns = helpers.concat(['getLabourHourRates', 'setExtraKind', 'setExtraLabour', 'addExtra',
    'getLabourFromCard', 'computeJobTotals', 'validatePricing']);
  vm.runInContext(fns.map(extractFunction).join('\n') + '\n' + extractFrom('window.buildPricingJson = function()'), sb);
  return sb;
}
function extractFrom(marker) {
  var start = SRC.indexOf(marker);
  if (start < 0) throw new Error(marker + ' not found in index.html');
  var open = SRC.indexOf('{', start), depth = 0;
  for (var i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1) + ';'; }
  }
  throw new Error('unbalanced braces after ' + marker);
}
function codes(list) { return list.map(function(e) { return e.code; }); }

console.log('\n5a. Every preset starts unclassified; the scoper picks Labour or Material');
{
  var app = makeApp();
  ['footings', 'electrical', 'downlights', 'demo', 'delivery', 'crane', 'permit', 'soakwell', 'skip', 'ceilingfan', 'other']
    .forEach(function(t) { app.addExtra(t); });
  assert(app.extrasRows.length === 11, 'ten named presets + Custom each add one row (got ' + app.extrasRows.length + ')');
  assert(app.extrasRows.every(function(r) { return app.extraRowKind(r) === null; }), 'every new preset row is unclassified (kind null)');
  app.addExtra('labour');
  assert(app.extrasRows.length === 11, 'there is no separate "labour" preset — + Custom then Labour covers it');

  var errs = app.validatePricing().errors.filter(function(e) { return e.code === 'EXTRA_KIND_UNSET'; });
  assert(errs.length === 10, 'the ten described presets block the send until classified; the blank Custom row does not (got ' + errs.length + ')');

  var demoIdx = 3;
  app.setExtraKind(demoIdx, 'material');
  assert(app.extrasRows[demoIdx].kind === 'material' && app.extrasRows[demoIdx].qty * app.extrasRows[demoIdx].unitCost === 500,
    'picking Material keeps the preset price');
  app.setExtraKind(0, 'labour');
  assert(app.extrasRows[0].kind === 'labour' && app.extrasRows[0].qty === 0 && app.extrasRows[0].unitCost === 45,
    'picking Labour asks for hours at the Settings $/hr');
  assert(codes(app.validatePricing().errors).indexOf('EXTRA_LABOUR_HOURS_MISSING') >= 0, 'a described labour line with no hours blocks the send');
  app.setExtraLabour(0, 'hours', '2');
  assert(codes(app.validatePricing().errors).indexOf('EXTRA_LABOUR_HOURS_MISSING') < 0, 'entering hours clears the block');
}

console.log('\n5b. A blank or zero-hour labour row produces nothing downstream');
{
  var rows = [
    { desc: '', kind: 'labour', unit: 'hrs', qty: 0, unitCost: 45, unitSell: 110, type: 'other' },
    { desc: 'Root removal', kind: 'labour', unit: 'hrs', qty: 2, unitCost: 45, unitSell: 110, type: 'other' }
  ];
  var app = makeApp({ extrasRows: rows });
  var v = app.validatePricing();
  assert(v.errors.length === 0, 'the blank labour row does not block the send (got ' + codes(v.errors).join(',') + ')');
  var wo = app.buildWorkOrderLabourTasks(app.getLabourFromCard(), app.extrasRows, 'full');
  assert(wo.tasks.map(function(t) { return t.task; }).join('|') === 'Patio install — trades|Root removal',
    'the work order has no "Extra labour — 0 hrs" task');
  var pj = app.buildPricingJson();
  var labourLines = pj.line_items.filter(function(li) { return li.kind === 'labour' && li.category !== 'labour'; });
  assert(labourLines.length === 1 && labourLines[0].description === 'Root removal' && labourLines[0].hours === 2,
    'pricing_json carries only the Root removal labour line, not a zero-hour phantom');
  assert(pj.line_items.every(function(li) { return li.kind !== 'labour' || li.quantity > 0; }),
    'no labour line_item has quantity 0 (integration.js would coerce it to 1 × $/hr on the labour PO)');

  var described = makeApp({ extrasRows: [{ desc: 'Root removal', kind: 'labour', qty: 0, unitCost: 45, unitSell: 110 }] });
  assert(codes(described.validatePricing().errors).indexOf('EXTRA_LABOUR_HOURS_MISSING') >= 0 &&
         described.extraLabourSummary(described.extrasRows).tasks.length === 0,
    'a described zero-hour labour row blocks the send and adds no work-order task');
  var hoursOnly = makeApp({ extrasRows: [{ desc: '', kind: 'labour', qty: 3, unitCost: 0, unitSell: 0 }] });
  assert(codes(hoursOnly.validatePricing().warnings).indexOf('EXTRA_LABOUR_RATE_MISSING') >= 0,
    'a labour row with hours but no description is not blank — its $0/hr is warned');
}

console.log('\n5c. Labour lines feed the labour figure; totals are unchanged');
{
  var rows = [
    { desc: 'Root removal', kind: 'labour', unit: 'hrs', qty: 2, unitCost: 45, unitSell: 110, type: 'other' },
    { desc: 'Soakwell', kind: 'material', qty: 1, unitCost: 800, unitSell: 1080, type: 'soakwell' },
    { desc: 'Legacy skip', qty: 1, unitCost: 350, unitSell: 473, type: 'skip' }
  ];
  var jobRows = [{ desc: 'SolarSpan 75mm panel', qty: 2, unit: 'each', unitCost: 110, unitSell: 200 }];
  var app = makeApp({ extrasRows: rows, jobRows: jobRows });
  var T = app.computeJobTotals();
  var labCard = 2 * 1 * 8 * 45;
  assert(T.labCost === labCard && T.extrasCost === 90 + 800 + 350, 'labour card cost and the extras sum are as entered');
  assert(T.totalCost === 220 + labCard + 1240, 'totalCost = materials + labour card + all extras (unchanged)');
  assert(T.extraLabourHours === 2 && T.extraLabourCost === 90 && T.extraLabourSell === 220, 'the labour split is 2 hrs, $90 cost, $220 sell');

  var pj = app.buildPricingJson();
  assert(Math.abs(pj.labourCostEstimate - (labCard + 90)) < 0.01, 'labourCostEstimate includes the Root removal hours × $/hr');
  assert(Math.abs(pj.materialCostEstimate - (220 / 1.1 + 800 + 350)) < 0.01, 'materialCostEstimate excludes it');
  assert(Math.abs(pj.materialCostEstimate + pj.labourCostEstimate - (T.trueCost)) < 0.01, 'materials + labour still equal the on-screen true cost');
  var byDesc = {};
  pj.line_items.forEach(function(li) { byDesc[li.description] = li; });
  var rr = byDesc['Root removal'];
  assert(rr.kind === 'labour' && rr.unit === 'hrs' && rr.quantity === 2 && rr.hours === 2 && rr.cost_per_hour === 45 && rr.supplier_name === '',
    'the labour scope line is kind "labour", unit hrs, with hours and cost_per_hour and no supplier');
  assert(byDesc['Soakwell'].kind === 'material' && byDesc['Legacy skip'].kind === 'material' && byDesc['SolarSpan 75mm panel'].kind === 'material',
    'material, legacy and jobRows line items are kind "material"');
  var crew = pj.line_items.filter(function(li) { return li.category === 'labour'; })[0];
  assert(crew && crew.kind === 'labour' && crew.hours === 16 && crew.cost_per_hour === 45, 'the labour-card line carries its crew hours (2 × 1 × 8)');

  var custom = makeApp({ extrasRows: rows, inputs: { inJobType: 'custom' } });
  assert(custom.computeJobTotals().extraLabourCost === 0 &&
         codes(custom.validatePricing().errors).indexOf('EXTRA_KIND_UNSET') < 0,
    'Custom jobs replace scope items, so their labour split and checks do not apply');
}

console.log('\n' + (failed ? 'FAILED: ' + failed + ' of ' + (passed + failed) + ' assertions' : 'PASSED: all ' + passed + ' assertions'));
process.exit(failed ? 1 : 0);
