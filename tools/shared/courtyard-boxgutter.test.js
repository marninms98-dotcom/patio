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

// ── 5. Structure-2 support build-up: fascia beam + small risers + riser beam ──
// The panels need something to fix to at the structure-2 end, mirroring the proven
// house-side box-gutter+riser detail. The plain front gutter beam is suppressed
// there and replaced by a fascia beam → small risers → riser beam build-up; the
// riser beam TOP sits at the panel front edge (frontTop) so the sheets fix to it
// and drain into the box gutter.
console.log('\n5. Structure-2 fascia beam + small risers + riser beam');
{
  // 5a. The plain front gutter beam is suppressed at the courtyard end so it does
  //     not sit buried in the wall/box-gutter junction.
  assert(/if\s*\(\s*!_courtyardFar\s*\)\s*\{\s*steelGrp\.add\(gutterBeamMesh\);/.test(FLAT),
    'plain front gutter beam add is gated behind !_courtyardFar (replaced by the riser build-up)');

  // 5b. All three members are registered as components.
  assert(/regComp\(\s*s2Fascia,\s*'Fascia Beam \(Structure 2\)'/.test(FLAT),
    "a 'Fascia Beam (Structure 2)' is registered (bolted to structure 2)");
  assert(/regComp\(\s*s2RiserBeam,\s*'Riser Beam \(Structure 2\)'/.test(FLAT),
    "a 'Riser Beam (Structure 2)' is registered (sheets fix to it)");
  assert(/regComp\(\s*s2Riser,\s*'Riser \(Structure 2\) '/.test(FLAT),
    "small 'Riser (Structure 2)' members are registered");

  // 5c. The build-up renders only for _courtyardFar and sits inside the box-gutter block.
  var buildup = /var s2SupPos\s*=([\s\S]*?regComp\(\s*s2Riser,\s*'Riser \(Structure 2\) '[\s\S]*?\})/.exec(SRC);
  assert(!!buildup, 'the fascia/riser/riser-beam build-up is present');
  var bu = buildup ? squish(buildup[1]) : '';

  // 5d. Riser beam TOP meets the clamped sheet far edge (just above frontTop) — sheets land on it.
  assert(/s2RiserBeamTopY\s*=\s*frontTop\s*\+\s*bgW2\s*\*\s*Math\.tan/.test(bu),
    'riser beam top = clamped sheet far edge (frontTop + bgW2·tan(pitch))');

  // 5e. The riser beam sits inboard of the box gutter (patio side of frontZ2 - bgW2),
  //     so the panels overhang past it and drain INTO the box gutter, not past the wall.
  assert(/var s2SupPos\s*=\s*\(\s*frontZ2\s*-\s*bgW2\s*\)/.test(FLAT),
    'riser build-up sits inboard of the box gutter (frontZ2 - bgW2), so panels drain into the gutter');

  // 5f. Small risers span from the fascia beam top up to the riser beam bottom.
  assert(/s2RiserH\s*=\s*Math\.max\([^,]+,\s*s2RiserBeamBotY\s*-\s*s2FasciaTopY\s*\)/.test(bu),
    'small risers span fascia-beam-top → riser-beam-bottom (the vertical build-up)');
}

// ── 6. The sheet run is CLAMPED to the box-gutter line at structure 2 ─────────
// The required outcome: the roof sheets visibly RUN INTO the box gutter at
// structure 2 — the sheet far edge terminates at the box-gutter line
// (frontZ2 - box gutter width) instead of running to the wall and rising above
// it. The rendered slope length is shortened by the box-gutter width for the
// courtyard-far end; the pricing rafter (c.rafter) is untouched.
console.log('\n6. Sheet run clamped to the box-gutter line (panels run INTO the gutter)');
{
  // The shared box-gutter width is declared once and reused by the clamp + box gutter.
  assert(/const _s2BoxGutterW\s*=\s*0\.22\s*;/.test(SRC),
    'a shared _s2BoxGutterW (box-gutter width) is declared');

  // The clamp is only applied at the courtyard-far end and is derived from the box-gutter width,
  // measured along the courtyard sheet slope (_cySheetPitchRad — see §7) so it stays consistent
  // with the raised, geometry-consistent plane.
  assert(/const _s2SheetClamp\s*=\s*_courtyardFar\s*\?\s*\(\s*_s2BoxGutterW\s*\/\s*Math\.cos\(_cySheetPitchRad\)\s*\)\s*:\s*0\s*;/.test(SRC),
    'sheet clamp = _courtyardFar ? box-gutter width along the (courtyard) slope : 0 (render-only)');

  // The clamp is actually subtracted from the rendered slope length so the far edge retreats.
  assert(/const _sheetSlopeLen\s*=[\s\S]{0,120}?extRafter\s*-\s*_s2SheetClamp/.test(SRC),
    'the clamp is subtracted from the rendered sheet slope length (front edge pulled back to the gutter)');

  // The box gutter reuses the SAME width constant, so the clamp lands the sheet exactly on it.
  assert(/var bgW2\s*=\s*_s2BoxGutterW\s*;/.test(SRC),
    'the box gutter reuses _s2BoxGutterW (clamp line == box-gutter line)');
}

// ── 7. Courtyard sheet plane fixes ONTO the box gutter at HEIGHT (no droop) ────
// The original follow-up bug: when the structure-2 front beam was pinned to fasciaH2
// (NOT userPitch), matching fascia heights made the courtyard roof plane (near) level
// (rise ≈ 0) while the sheets were still tilted at c.pitchRad (userPitch), so over the
// span the far edge drooped ~half a metre BELOW the front/riser beam — the panels
// sagged UNDER the box gutter with a visible gap ("sheets are still too low"). Rendering
// the courtyard sheet plane at the geometry-consistent pitch (atan(rise/span)) instead of
// c.pitchRad landed the far edge back ON the riser beam / box gutter.
//   The courtyard front beam is now DERIVED from userPitch in the isBetweenStructures
// override (frontBeamY = backBeamY -/+ W·tan(userPitch)), so the actual rise ==
// W·tan(userPitch) and _cySheetPitchRad below == c.pitchRad — the substitution is a
// self-healing no-op that stays as a consistency guard (this test pins its
// geometry-derived form). Pitch now drives both the sheet angle and the box-gutter
// height together. Non-courtyard skillions always had rise == W·tan(userPitch) exactly.
console.log('\n7. Courtyard sheet plane uses the geometry-consistent pitch (far edge fixes onto the box gutter)');
{
  // 7a. A courtyard-specific sheet pitch is derived from the ACTUAL beam rise / span,
  //     gated on _courtyardFar (falls back to c.pitchRad everywhere else).
  var decl = /const _cySheetPitchRad\s*=([\s\S]{0,220}?);/.exec(SRC);
  assert(!!decl, '_cySheetPitchRad is declared');
  var d = decl ? squish(decl[1]) : '';
  assert(/_courtyardFar\s*\?/.test(d),
    '  the courtyard sheet pitch is gated on _courtyardFar (non-courtyard keeps c.pitchRad)');
  assert(/Math\.atan2\(/.test(d) && /c\.backBeamY\s*-\s*c\.frontBeamY/.test(d) && /:\s*c\.pitchRad/.test(d),
    '  = atan2(actual rise (backBeamY-frontBeamY), span) for courtyard, else c.pitchRad');

  // 7b. The standard-skillion sheet rotation uses the courtyard pitch, so the far
  //     edge no longer droops below the riser beam at userPitch.
  assert(/sheet\.rotation\.x\s*=\s*Math\.PI\/2\s*\+\s*_cySheetPitchRad\s*;/.test(SRC),
    'standard-skillion sheet tilt uses _cySheetPitchRad (raised far edge, no droop)');

  // 7c. The structure-2 clamp is measured along the SAME (courtyard) slope, so the
  //     far edge lands exactly on the box-gutter line at the raised height.
  assert(/_s2SheetClamp\s*=\s*_courtyardFar\s*\?\s*\(\s*_s2BoxGutterW\s*\/\s*Math\.cos\(_cySheetPitchRad\)\s*\)/.test(SRC),
    'the box-gutter clamp uses _cySheetPitchRad (clamp line consistent with the raised plane)');
}

console.log('\n' + (failed ? ('FAILED: ' + failed + ' / ' + (passed + failed))
                            : ('PASSED: all ' + passed + ' assertions')));
process.exit(failed ? 1 : 0);
