#!/usr/bin/env node
/**
 * Regression coverage for LABOUR / MATERIAL scope items (work-order step 1).
 *
 * The bug: an extra line such as "Root removal" was money with no kind and no
 * hours. Its cost landed in the materials figure, and the trade's work order
 * showed nothing (or "1 job") instead of how many hours to spend on it.
 *
 * The fix (index.html):
 *   • every scope-item (extrasRows) row is Labour or Material — '+ Custom' starts
 *     unclassified and validatePricing() blocks the send until the scoper picks;
 *   • a Labour row is priced from hours (qty = hours, unitCost = $/hr), and its
 *     cost counts in labourCostEstimate, not materialCostEstimate;
 *   • pricing_json.line_items carry kind (+ hours, cost_per_hour on labour);
 *   • the Work Order PDF lists every labour task with its hours, no dollars;
 *   • rows saved before `kind` existed stay material, so old quotes price the same.
 *
 * Two kinds of check below:
 *   • BEHAVIOURAL — the pure helpers are cut out of index.html by name and run.
 *   • STRUCTURAL proofs over index.html source for the DOM-bound wiring (same
 *     approach as courtyard-boxgutter.test.js).
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
function squish(s) { return s.replace(/\s+/g, ' '); }

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
function functionBody(name) { return squish(extractFunction(name)); }

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

// ── 5. Wiring: totals, pricing_json, validation, presets ──────────────────
console.log('\n5. Labour lines feed the labour figure; totals unchanged; send blocked until classified');
{
  var cjt = functionBody('computeJobTotals');
  assert(/var extraLab = extrasCountForJobType\(_jobType\) \? extraLabourSummary\(extrasRows\)/.test(cjt),
    'computeJobTotals splits out labour-kind scope items (gated by job type)');
  assert(/var totalCost = matCost \+ addMatCost \+ labCost \+ extrasCost \+ demoCost;/.test(cjt) &&
         /var trueCost = \(matCost \+ addMatCost\) \/ 1\.1 \+ labCost \+ extrasCost \+ demoCost;/.test(cjt),
    'totalCost and trueCost formulas are unchanged (labour extras stay inside extrasCost)');
  assert(/extraLabourHours: extraLab\.hours, extraLabourCost: extraLab\.cost/.test(cjt), 'computeJobTotals returns the labour split');

  var bpjStart = SRC.indexOf('window.buildPricingJson = function()');
  var bpj = squish(SRC.slice(bpjStart, SRC.indexOf('return {', bpjStart)));
  assert(/var materialCostEstimate = \(matCost \+ addMatCost\) \/ 1\.1 \+ extrasCost - T\.extraLabourCost \+ demoCost;/.test(bpj),
    'materialCostEstimate excludes labour-kind scope items');
  assert(/var labourCostEstimate = labCost \+ T\.extraLabourCost;/.test(bpj),
    'labourCostEstimate includes labour-kind scope items');
  assert(/kind: kind \};/.test(bpj) && /li\.hours = /.test(bpj) && /li\.cost_per_hour = /.test(bpj),
    'scope-item line_items carry kind, and labour ones hours + cost_per_hour');
  assert(/unit: kind === 'labour' \? 'hrs' : 'each'/.test(bpj), 'labour scope-item line_items use unit "hrs"');
  assert(/category: 'labour', kind: 'labour', \/\/ Crew hours for the work order: trades \+ labourers\. hours:/.test(bpj),
    'the labour-card line item carries kind "labour" and its crew hours');
  assert((bpj.match(/kind: 'material'/g) || []).length >= 3, 'jobRows, additional materials and demo line items carry kind "material"');

  var vp = functionBody('validatePricing');
  assert(/code: 'EXTRA_KIND_UNSET'/.test(vp) && /errors\.push\(\{ code: 'EXTRA_KIND_UNSET'/.test(vp),
    'an unclassified scope item is a blocking error');
  assert(/errors\.push\(\{ code: 'EXTRA_LABOUR_HOURS_MISSING'/.test(vp), 'a labour line with no hours is a blocking error');
  assert(/warnings\.push\(\{ code: 'EXTRA_LABOUR_RATE_MISSING'/.test(vp), 'a labour line with $0/hr only warns (never-blocked rate ruling)');
  assert(/if \(extraRowIsBlank\(r\)\) return;/.test(vp), 'blank rows are skipped');

  var ae = functionBody('addExtra');
  assert((ae.match(/kind: 'material' \}/g) || []).length === 10, 'all ten named presets state kind "material" explicitly');
  assert(/other: \{[^}]*type: 'other', kind: null \}/.test(ae), '"+ Custom" starts unclassified (kind null) — no silent default');
  assert(/labour: \{[^}]*type: 'labour', kind: 'labour', unit: 'hrs' \}/.test(ae), '"+ Extra Labour (hrs)" adds a labour row priced in hours');
}

// ── 6. Work Order PDF: labour section with hours and no dollars ───────────
console.log('\n6. The Work Order PDF prints LABOUR — HOURS with no dollar amounts');
{
  var wo = extractFunction('generateWorkOrderPDF');
  var a = wo.indexOf("// Labour hours section:");
  var b = wo.indexOf('var steps = [];');
  assert(a > 0 && b > a, 'the labour section sits at the top of the How To Build page');
  var section = wo.slice(a, b);
  assert(/buildWorkOrderLabourTasks\(getLabourFromCard\(\), extrasRows, woJobType\)/.test(section),
    'the section is built from the labour card + labour scope items');
  assert(/woSectionTitle\('LABOUR \\u2014 HOURS', y\)/.test(section), 'section title is LABOUR — HOURS');
  assert(section.indexOf('$') < 0 && !/cost|sell|rate/i.test(section.replace(/\/\/[^\n]*/g, '')),
    'the section code prints no $ and reads no cost, sell or rate');
}

console.log('\n' + (failed ? 'FAILED: ' + failed + ' of ' + (passed + failed) + ' assertions' : 'PASSED: all ' + passed + ' assertions'));
process.exit(failed ? 1 : 0);
