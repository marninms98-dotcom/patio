#!/usr/bin/env node
/**
 * Regression coverage for the COURTYARD (between-two-structures) box-gutter
 * termination in the 3D render.
 *
 * The bug: a courtyard patio (roof spanning between structure 1 and structure 2)
 * rendered the panels running flat, wall-to-wall, terminating INTO structure 2's
 * wall face — with only the open-front "quad" eaves gutter that belongs on an
 * OPEN front edge. Physically the panels can't drain onto a neighbouring building:
 * where the roof abuts structure 2 they must run into a BOX GUTTER tucked in the
 * junction. See fm/patio-courtyard-panel-gutter-render.
 *
 * The fix (all render-side, inside the big draw function in index.html):
 *   1. A `_courtyardFar` flag = full-coverage, standard-pitch courtyard
 *      (isBetweenStructures && isAttached && !struct2IsPartial && !isReverse).
 *   2. At that end the open-front quad gutter + edge wrap are SUPPRESSED
 *      (guarded by !_courtyardFar) — they belong on an open eave, not a wall junction.
 *   3. A "Box Gutter (Structure 2)" U-channel is rendered in the courtyard block,
 *      guarded by _courtyardFar: taller outer upstand against structure 2's wall,
 *      shorter patio-side upstand the panel far edge overhangs, channel bottom
 *      seated below the panel front edge (frontTop) so panels drain INTO it.
 *
 * These are structural proofs over index.html (same approach as
 * quote-send.test.js's "index.html wires the module" proofs) because the geometry
 * is emitted by a DOM+THREE.js render function that can't be unit-executed
 * headlessly. They fail loudly if the box gutter, the suppression guard, or the
 * height rule is removed — so the wall-burial cannot silently return.
 *
 * Run: node tools/shared/courtyard-boxgutter.test.js
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

// Collapse runs of whitespace so assertions tolerate reformatting/reindentation.
function squish(s) { return s.replace(/\s+/g, ' '); }
var FLAT = squish(SRC);

// ── 1. The `_courtyardFar` invariant is defined with all four conditions ──────
console.log('\n1. _courtyardFar = full-coverage, standard-pitch courtyard');
{
  var decl = /const _courtyardFar\s*=([\s\S]{0,240}?);/.exec(SRC);
  assert(!!decl, '_courtyardFar is declared');
  var body = decl ? squish(decl[1]) : '';
  assert(/isBetweenStructures/.test(body), '  guards on courtyard (isBetweenStructures)');
  assert(/isAttached/.test(body), '  requires an attached connection (isAttached)');
  assert(/!\s*c\.struct2IsPartial/.test(body),
    '  full coverage only — partial structure 2 keeps the open-front gutter');
  assert(/!\s*c\.isReverse/.test(body),
    '  standard pitch only — reverse skillion drains to the house end, not structure 2');
}

// ── 2. Open-front quad gutter + edge wrap are SUPPRESSED at the courtyard end ─
console.log('\n2. Open-front quad gutter + edge wrap suppressed where panels meet structure 2');
{
  // The main skillion front gutter: its add + registration must sit inside an
  // `if (!_courtyardFar) { ... }` block so it does NOT render at structure 2.
  var guarded = /if\s*\(\s*!_courtyardFar\s*\)\s*\{\s*accGrp\.add\(gutter\);\s*regComp\(gutter,\s*'Gutter',\s*\{\s*'Type':\s*'150mm Quad'/;
  assert(guarded.test(FLAT),
    "open-front quad 'Gutter' add + regComp are gated behind !_courtyardFar");

  // The SolarSpan edge wrap that closes an open front edge is likewise gated.
  assert(/if\s*\(\s*isInsulated\(c\.roofing\)\s*&&\s*!_courtyardFar\s*\)/.test(FLAT),
    'gutter edge wrap is gated behind !_courtyardFar (no open-eave wrap at a wall junction)');
}

// ── 3. A box gutter is rendered at structure 2, guarded by _courtyardFar ──────
console.log('\n3. Box Gutter (Structure 2) rendered where the panels terminate');
{
  assert(/regComp\(\s*boxGutter2,\s*'Box Gutter \(Structure 2\)'/.test(FLAT),
    "a 'Box Gutter (Structure 2)' component is registered");

  // The box gutter block itself must be guarded by _courtyardFar (positive form).
  var block = /if\s*\(\s*_courtyardFar\s*\)\s*\{([\s\S]*?regComp\(\s*boxGutter2,\s*'Box Gutter \(Structure 2\)'[\s\S]*?\})/.exec(SRC);
  assert(!!block, 'the box gutter renders only when _courtyardFar (inside if (_courtyardFar) { ... })');
  var b = block ? squish(block[1]) : '';

  // Height rule: channel bottom seats below the panel front edge (frontTop) so
  // panels drain INTO it — "picked up to gutter height", not buried in the wall.
  assert(/bgY2\s*=\s*frontTop\s*-\s*bgInner/.test(b),
    'channel bottom = frontTop - bgInner (panel front edge lands at the gutter, not the wall)');

  // Profile: the outer (wall-side) upstand is TALLER than the patio-side upstand
  // so water is contained against structure 2 and the panel overhangs the inner lip.
  var outer = /bgOuter\s*=\s*([0-9.]+)/.exec(b);
  var inner = /bgInner\s*=\s*([0-9.]+)/.exec(b);
  assert(outer && inner && parseFloat(outer[1]) > parseFloat(inner[1]),
    'wall-side upstand (bgOuter) is taller than the patio-side upstand (bgInner)');
}

// ── 4. The near (structure 1 / house) end is untouched ───────────────────────
console.log('\n4. Near-end house gutter is preserved (fix is scoped to structure 2)');
{
  // The house-side quad gutter registration still exists and is NOT gated on the
  // courtyard-far flag — the near end keeps rendering exactly as before.
  assert(/regComp\([^;]*'House Quad Gutter'/.test(FLAT),
    "'House Quad Gutter' is still registered (near-end attachment unchanged)");
}

console.log('\n' + (failed ? ('FAILED: ' + failed + ' / ' + (passed + failed))
                            : ('PASSED: all ' + passed + ' assertions')));
process.exit(failed ? 1 : 0);
