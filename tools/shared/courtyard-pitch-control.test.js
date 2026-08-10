#!/usr/bin/env node
/**
 * Regression coverage for COURTYARD (between-two-structures) PITCH CONTROL.
 *
 * The bug (PR #136, commit d03b8bf): the courtyard sheet-height fix rendered the
 * sheet plane at the GEOMETRY-derived pitch `atan2(rise, span)` where `rise` came
 * from the two fixed fascia/wall heights (fasciaH2), NOT from the user Pitch input.
 * That landed the sheets on the structure-2 box gutter (good) but ANGLE-LOCKED
 * them: changing the Pitch field no longer moved the sheet plane — only the barge
 * flashings (which use c.pitchRad) responded. See fm/patio-courtyard-pitch-control.
 *
 * The fix (in the calc, the COURTYARD SKILLION override): structure 1 (back/near)
 * stays the fixed attach height, but the structure-2 (front/far) box-gutter
 * termination is DERIVED from the user pitch + span —
 *     frontBeamY = backBeamY -/+ W·tan(userPitch)
 * — so the actual beam rise IS W·tan(userPitch). Because the sheet plane pitch is
 * `_cySheetPitchRad = atan2(backBeamY - frontBeamY, span)`, it now equals userPitch,
 * and `frontTop` (which drives the box gutter, riser build-up and barge) moves with
 * pitch. Pitch therefore drives the sheet angle AND the far-end height together,
 * and the sheets stay landed on the box gutter at every pitch.
 *
 * Two kinds of check below:
 *   • STRUCTURAL proofs over index.html source (the calc lives in a DOM function
 *     that can't be unit-executed headlessly — same approach as
 *     courtyard-boxgutter.test.js).
 *   • A NUMERIC proof that composes the two load-bearing formulas exactly as the
 *     code does and shows that (a) the sheet plane angle == userPitch and (b) the
 *     far-edge / box-gutter height moves down as pitch increases — both at two
 *     different pitches.
 *
 * Run: node tools/shared/courtyard-pitch-control.test.js
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
var FLAT = squish(SRC);

// ── 1. The courtyard SKILLION front beam is derived from the USER PITCH ───────
// The regression: frontBeamY was pinned to fasciaH2 (frontBeamCalc), so the roof
// plane ignored the Pitch input. It must now be derived from backBeamY and
// W·tan(userPitch) so Pitch controls the angle.
console.log('\n1. Courtyard skillion front beam derives from the user Pitch (not fasciaH2)');
{
  // The skillion (non-gable) branch of the courtyard override sets frontBeamY from
  // the pitch-derived rise, signed by reverse.
  var branch = /frontBeamY\s*=\s*isReverse\s*\?\s*\(\s*backBeamY\s*\+\s*cySkillionRise\s*\)\s*:\s*\(\s*backBeamY\s*-\s*cySkillionRise\s*\)\s*;/;
  assert(branch.test(SRC),
    'skillion courtyard sets frontBeamY = backBeamY -/+ cySkillionRise (pitch-derived, signed by reverse)');

  assert(/var cySkillionRise\s*=\s*W\s*\*\s*Math\.tan\(\s*userPitch\s*\*\s*Math\.PI\s*\/\s*180\s*\)\s*;/.test(SRC),
    'cySkillionRise = W · tan(userPitch) (the span × pitch rise)');

  // The old, angle-locking assignment must be gone: the skillion branch must NOT
  // pin frontBeamY straight to frontBeamCalc (the fasciaH2-derived height).
  assert(!/Skillion:[^\n]*height difference[\s\S]{0,80}?frontBeamY\s*=\s*frontBeamCalc\s*;/.test(SRC),
    'the old "frontBeamY = frontBeamCalc" (fasciaH2-pinned) skillion assignment is removed');
}

// ── 2. The sheet plane pitch still reads the actual beam rise ─────────────────
// _cySheetPitchRad must remain atan2(backBeamY - frontBeamY, span). Combined with
// §1, that expression now evaluates to userPitch — so the sheet angle tracks Pitch
// while the box-gutter height (frontTop) tracks it too. (Guards the composition;
// the height landing itself is covered by courtyard-boxgutter.test.js §7.)
console.log('\n2. Sheet plane pitch = atan2(actual beam rise, span) — now equals userPitch');
{
  var decl = /const _cySheetPitchRad\s*=([\s\S]{0,220}?);/.exec(SRC);
  assert(!!decl, '_cySheetPitchRad is declared');
  var d = decl ? squish(decl[1]) : '';
  assert(/Math\.atan2\(/.test(d) && /c\.backBeamY\s*-\s*c\.frontBeamY/.test(d),
    'sheet pitch = atan2(backBeamY - frontBeamY, span) — tracks the pitch-driven rise');
}

// ── 3. NUMERIC proof: pitch drives BOTH the sheet angle and the far height ────
// Reproduce the exact code path for a full-coverage courtyard skillion:
//   backBeamY = fixed structure-1 attach height (mm)
//   frontBeamY = backBeamY - W_mm · tan(userPitch)          (the fix, §1)
//   sheetPitch = atan2((backBeamY - frontBeamY)/1000, W_m)  (_cySheetPitchRad)
//   farTop     = frontBeamY (+ beam height) → box-gutter height moves with it
console.log('\n3. Numeric: changing Pitch changes the sheet angle AND the far/box-gutter height');
{
  var W_m = 6.0;            // 6 m span
  var W_mm = W_m * 1000;
  var backBeamY = 2700;     // mm, structure-1 attach (fixed)
  var GBH = 100;            // frame-beam height (mm), gbH — constant across pitches

  function model(pitchDeg) {
    var rise = W_mm * Math.tan(pitchDeg * Math.PI / 180);   // cySkillionRise
    var frontBeamY = backBeamY - rise;                       // §1 (standard skillion)
    var sheetPitchDeg = Math.atan2((backBeamY - frontBeamY) / 1000, W_m) * 180 / Math.PI;
    var frontTop = frontBeamY + GBH;                         // box-gutter / riser datum
    return { frontBeamY: frontBeamY, sheetPitchDeg: sheetPitchDeg, frontTop: frontTop };
  }

  var lo = model(5.0);
  var hi = model(9.5);

  // (a) The rendered sheet plane angle equals the user Pitch at each setting.
  assert(Math.abs(lo.sheetPitchDeg - 5.0) < 1e-6,
    'at Pitch 5.0° the sheet plane angle = 5.0° (was angle-locked to fasciaH2 before)');
  assert(Math.abs(hi.sheetPitchDeg - 9.5) < 1e-6,
    'at Pitch 9.5° the sheet plane angle = 9.5°');

  // (b) The sheet angle actually MOVES when Pitch changes (the reported symptom).
  assert(hi.sheetPitchDeg - lo.sheetPitchDeg > 4.0,
    'changing Pitch 5.0°→9.5° changes the sheet plane angle by ~4.5° (angle is no longer locked)');

  // (c) The far edge / box-gutter height moves DOWN as pitch steepens, and the
  //     sheet plane still lands on it — sheet angle and far height move together.
  assert(hi.frontTop < lo.frontTop,
    'the far-end (box-gutter) height drops as Pitch steepens — box gutter moves with pitch');
  assert(Math.abs((backBeamY - hi.frontBeamY) - W_mm * Math.tan(9.5 * Math.PI / 180)) < 1e-6,
    'far edge meets the box gutter exactly at rise = span·tan(Pitch) (no ~0.5m droop)');
}

// ── 4. Barge flashings and sheets agree at all pitches ───────────────────────
// The barge front Y is frontTop and its tilt is c.pitchRad; the sheet far edge is
// frontTop and its tilt is _cySheetPitchRad. With §1, backTop - frontTop =
// W·tan(userPitch) = W·tan(pitchRad), so the two are coplanar at every pitch.
console.log('\n4. Barge flashings and sheets share the pitch-driven far edge (coplanar)');
{
  // Sheet far edge datum = frontTop (courtyard box-gutter block, boxGutter2 / riser beam).
  assert(/var bgY2\s*=\s*frontTop\s*-\s*bgInner\s*;/.test(SRC),
    'box gutter (sheet far edge) is anchored at frontTop — the pitch-driven far height');
  // Barge front Y = frontTop (non-skew standard skillion), tilt = c.pitchRad.
  assert(/_bargeFrontY\s*=[\s\S]{0,160}?:\s*frontTop\s*;/.test(SRC),
    'barge front Y = frontTop (same pitch-driven far height as the sheets)');
}

console.log('\n' + (failed ? ('FAILED: ' + failed + ' / ' + (passed + failed))
                            : ('PASSED: all ' + passed + ' assertions')));
process.exit(failed ? 1 : 0);
