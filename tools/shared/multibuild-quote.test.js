#!/usr/bin/env node
/**
 * Regression coverage for the multi-build (bundle) quote helpers.
 *
 * Proves the load-bearing invariants with FAKES only — zero DOM, zero network:
 *   1. Combined pricing sums every structure + shared costs into ONE inc-GST total.
 *   2. The staged schedule reconciles to the combined total to the cent
 *      (final claim absorbs the remainder) — for N = 2..6 and messy totals.
 *   3. The captain's target example reproduces EXACTLY:
 *      $110,058.16 → 50% / 15% / 15% / 15% / 5% = 55,029.08 / 16,508.72 ×3 / 5,502.92.
 *   4. Per-structure claims are EQUAL (not value-weighted).
 *   5. Spec consolidation: identical builds ⇒ all common; a differing key ⇒ delta.
 *   6. Readiness gate blocks until every structure is scoped + rendered + priced.
 *
 * Run: node tools/shared/multibuild-quote.test.js
 */
'use strict';

var path = require('path');
var ROOT = path.resolve(__dirname, '../..');
var M = require(path.join(ROOT, 'tools/shared/multibuild-quote.js'));

var failed = 0, passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.error('  FAIL — ' + msg); }
}
function assertEq(a, b, msg) {
  assert(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}
function round2(n) { return Math.round(n * 100) / 100; }

// ── 1 + 3 + 4. Target example: 3 structures, $110,058.16 combined ─────────────
console.log('\n1/3/4. Target example (Quote_Will_Gethin_SWP-261126_3-Builds): exact reproduction');
{
  // The example's combined inc-GST total is $110,058.16. Per-structure sells are
  // unknown (the schedule is % of the COMBINED total), so feed structure totals
  // that sum to the combined total; the schedule must not depend on their split.
  var structures = [
    { label: 'Build A', dimsStr: '8.0m × 4.1m', roofAreaM2: 32.8, totalIncGST: 50000, totalExGST: 45454.55 },
    { label: 'Build B', dimsStr: '6.1m × 4.1m', roofAreaM2: 25.0, totalIncGST: 40000, totalExGST: 36363.64 },
    { label: 'Build C', dimsStr: '4.1m × 4.1m', roofAreaM2: 16.8, totalIncGST: 20058.16, totalExGST: 18234.69 }
  ];
  var r = M.buildBundlePricing(structures);
  assertEq(r.combinedTotalIncGST, 110058.16, 'combined inc-GST total = sum of every structure');
  assertEq(r.structureCount, 3, '3 structures');
  assertEq(r.roofAreaTotalStr, '74.6', 'combined roof area 74.6 m² (32.8 + 25 + 16.8)');

  var s = r.schedule;
  assertEq(s.length, 5, 'schedule = deposit + 3 structures + final');
  assertEq(s[0].kind, 'deposit', 's0 is deposit');   assertEq(s[0].pctStr, '50', 'deposit 50%');   assertEq(s[0].amt, 55029.08, 'deposit $55,029.08');
  assertEq(s[1].kind, 'structure', 's1 structure A'); assertEq(s[1].pctStr, '15', 'structure 15%'); assertEq(s[1].amt, 16508.72, 'structure A $16,508.72');
  assertEq(s[2].amt, 16508.72, 'structure B $16,508.72 (EQUAL, not value-weighted)');
  assertEq(s[3].amt, 16508.72, 'structure C $16,508.72 (EQUAL despite smaller structure)');
  assertEq(s[4].kind, 'final', 's4 is final');       assertEq(s[4].pctStr, '5', 'final 5%');       assertEq(s[4].amt, 5502.92, 'final $5,502.92 (exact remainder)');
  assertEq(s[1].desc, '8.0m × 4.1m', 'structure A milestone shows its dims');
  assertEq(s[3].desc, '4.1m × 4.1m', 'structure C milestone shows its dims');
  assert(r.reconciles, 'schedule reconciles to the combined total');
  assertEq(round2(s.reduce(function (a, x) { return a + x.amt; }, 0)), 110058.16, 'schedule sums to $110,058.16 exactly');
}

// ── 2. Reconciliation across N + messy totals ─────────────────────────────────
console.log('\n2. Schedule reconciles to the cent for N = 2..6 and awkward totals');
{
  [2, 3, 4, 5, 6].forEach(function (n) {
    [12345.67, 99999.99, 250000, 7777.77].forEach(function (total) {
      var per = round2(total / n);
      var structs = [];
      var acc = 0;
      for (var i = 0; i < n; i++) {
        var t = (i === n - 1) ? round2(total - acc) : per;
        acc = round2(acc + t);
        structs.push({ label: 'S' + i, dimsStr: '', roofAreaM2: 10, totalIncGST: t });
      }
      var r = M.buildBundlePricing(structs);
      assertEq(r.combinedTotalIncGST, round2(total), 'N=' + n + ' total ' + total + ' sums correctly');
      var sum = round2(r.schedule.reduce(function (a, x) { return a + x.amt; }, 0));
      assertEq(sum, round2(total), 'N=' + n + ' total ' + total + ' schedule reconciles to the cent');
      assert(r.reconciles, 'N=' + n + ' total ' + total + ' reconciles flag true');
      assertEq(r.schedule.length, n + 2, 'N=' + n + ' schedule length = n + 2');
    });
  });
  // N=2 → middle 45% split → 22.5% each.
  var r2 = M.buildBundlePricing([{ totalIncGST: 100000 }, { totalIncGST: 100000 }]);
  assertEq(r2.schedule[1].pctStr, '22.5', 'N=2 per-structure = 22.5%');
}

// ── 3b. Shared costs fold into the combined total ─────────────────────────────
console.log('\n3b. Shared costs (delivery/skip/permit) fold into the combined total');
{
  var r = M.buildBundlePricing(
    [{ totalIncGST: 50000 }, { totalIncGST: 50000 }],
    { sharedCostsIncGST: 1000 }
  );
  assertEq(r.combinedTotalIncGST, 101000, 'shared inc-GST added to structures');
  var sum = round2(r.schedule.reduce(function (a, x) { return a + x.amt; }, 0));
  assertEq(sum, 101000, 'schedule still reconciles with shared costs');
}

// ── 5. Spec consolidation ─────────────────────────────────────────────────────
console.log('\n5. Spec consolidation: common-to-all vs per-build deltas');
{
  var identical = [
    { label: 'A', specs: [['Dimensions', '8.0m × 4.1m · 33 m²'], ['Style', 'Skillion roof patio'], ['Roofing', 'ProDek, Monument'], ['Frame Colour', 'Monument, powdercoated steel'], ['Posts', '90×90×2 SHS × 6']] },
    { label: 'B', specs: [['Dimensions', '6.1m × 4.1m · 25 m²'], ['Style', 'Skillion roof patio'], ['Roofing', 'ProDek, Monument'], ['Frame Colour', 'Monument, powdercoated steel'], ['Posts', '90×90×2 SHS × 6']] },
    { label: 'C', specs: [['Dimensions', '4.1m × 4.1m · 17 m²'], ['Style', 'Skillion roof patio'], ['Roofing', 'ProDek, Monument'], ['Frame Colour', 'Monument, powdercoated steel'], ['Posts', '90×90×2 SHS × 6']] }
  ];
  var c = M.consolidateSpecs(identical);
  assert(c.allCommon, 'identical builds ⇒ allCommon true (only dims differ)');
  assert(!c.common.some(function (r) { return r[0] === 'Dimensions'; }), 'Dimensions never enters the shared table');
  assert(c.common.some(function (r) { return r[0] === 'Style' && r[1] === 'Skillion roof patio'; }), 'Style is common');
  assert(c.perBuild.every(function (b) { return b.deltas.length === 0; }), 'no per-build deltas when identical');

  var differ = JSON.parse(JSON.stringify(identical));
  differ[1].specs[2] = ['Roofing', 'SolarSpan 75mm, Surfmist'];  // B differs on roofing
  var c2 = M.consolidateSpecs(differ);
  assert(!c2.allCommon, 'differing roofing ⇒ not allCommon');
  assert(!c2.common.some(function (r) { return r[0] === 'Roofing'; }), 'Roofing leaves the shared table when builds differ');
  assert(c2.perBuild[1].deltas.some(function (r) { return r[0] === 'Roofing' && r[1] === 'SolarSpan 75mm, Surfmist'; }), 'B carries the roofing delta');
  assert(c2.common.some(function (r) { return r[0] === 'Style'; }), 'Style stays common when only roofing differs');
}

// ── 5b. pickDesignSpecs strips the post count ─────────────────────────────────
console.log('\n5b. pickDesignSpecs — page-2 4-row subset');
{
  var specs = [['Dimensions', 'x'], ['Style', 'Skillion roof patio'], ['Roofing', 'ProDek, Monument'], ['Frame Colour', 'Monument, powdercoated steel'], ['Posts', '90×90×2 SHS × 6']];
  var d = M.pickDesignSpecs(specs);
  assertEq(d.length, 4, 'exactly STYLE/ROOFING/FRAME/POSTS');
  assertEq(d[3][0], 'Posts', 'posts row present');
  assertEq(d[3][1], '90×90×2 SHS', 'post count stripped ("× 6" removed)');
  assertEq(d[2][0], 'Frame', 'Frame Colour surfaced as FRAME');
}

// ── 6. Readiness gate ─────────────────────────────────────────────────────────
console.log('\n6. assessBundleReadiness — fail closed until every structure is ready');
{
  var ready = [
    { label: 'Build A', scoped: true, hasRender: true, totalIncGST: 50000 },
    { label: 'Build B', scoped: true, hasRender: true, totalIncGST: 40000 }
  ];
  var g = M.assessBundleReadiness(ready, 90000);
  assert(g.ok && g.blockers.length === 0, 'all ready + combined total present ⇒ ok');

  var g2 = M.assessBundleReadiness([ready[0]], 50000);
  assert(!g2.ok, '<2 structures ⇒ blocked');

  var notReady = [
    { label: 'Build A', scoped: true, hasRender: false, totalIncGST: 50000 },
    { label: 'Build B', scoped: false, hasRender: true, totalIncGST: 0, hasBlockingPricingError: true }
  ];
  var g3 = M.assessBundleReadiness(notReady, 0);
  assert(!g3.ok, 'missing render / unscoped / $0 / pricing error / no combined total ⇒ blocked');
  assert(g3.blockers.some(function (b) { return /no 3D render/.test(b); }), 'flags the missing render');
  assert(g3.blockers.some(function (b) { return /not been scoped/.test(b); }), 'flags the unscoped build');
  assert(g3.blockers.some(function (b) { return /pricing error/.test(b); }), 'flags the pricing error');
  assert(g3.blockers.some(function (b) { return /combined project total is missing/.test(b); }), 'flags the missing combined total');
}

// ── 7. Prose ──────────────────────────────────────────────────────────────────
console.log('\n7. Bundle prose reads naturally');
{
  var consolidated = M.consolidateSpecs([
    { label: 'A', specs: [['Dimensions', 'x'], ['Style', 'Skillion roof patio'], ['Attachment', 'Freestanding'], ['Roofing', 'ProDek, Monument'], ['Frame Colour', 'Monument, powdercoated steel']] },
    { label: 'B', specs: [['Dimensions', 'y'], ['Style', 'Skillion roof patio'], ['Attachment', 'Freestanding'], ['Roofing', 'ProDek, Monument'], ['Frame Colour', 'Monument, powdercoated steel']] },
    { label: 'C', specs: [['Dimensions', 'z'], ['Style', 'Skillion roof patio'], ['Attachment', 'Freestanding'], ['Roofing', 'ProDek, Monument'], ['Frame Colour', 'Monument, powdercoated steel']] }
  ]);
  var lede = M.bundleDesignLede(consolidated, 3);
  assert(/^Three separate structures/.test(lede), 'lede opens with the structure count word');
  assert(/freestanding skillion roof/.test(lede), 'lede names the common attachment + style');
  assert(/in ProDek sheeting, Monument/.test(lede), 'lede phrases roofing as "ProDek sheeting, Monument"');
  assert(/framed in powdercoated Monument steel/.test(lede), 'lede phrases frame as "powdercoated Monument steel" (colour kept capitalised)');
  assert(/designed to sit together as one consistent set\.$/.test(lede), 'lede closes with the bundle framing');

  var lead = M.bundleScopeLead(
    [{ dimsStr: '8.0m × 4.1m' }, { dimsStr: '6.1m × 4.1m' }, { dimsStr: '4.1m × 4.1m' }],
    { connectionPhrase: 'freestanding (not attached to any building)' }
  );
  assert(/^All three structures — 8.0m × 4.1m, 6.1m × 4.1m and 4.1m × 4.1m/.test(lead), 'scope lead joins dims with commas + "and"');
  assert(/engineered, council-ready plans\.$/.test(lead), 'scope lead ends on council-ready plans');
}

console.log('\n────────────────────────────────────');
console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('All multi-build bundle helper regressions green.');
