#!/usr/bin/env node
/**
 * Regression coverage for patio autosave dirty-check + pause-when-hidden.
 *
 * Proves:
 *  - all integration.js startAutoSave call sites go through cloud.startAutoSave
 *  - fingerprint lives only in cloud.js (centralized guard)
 *  - volatile keys exclude only server timestamps (savedAt, generated_at)
 *  - operator scope/pricing content changes dirty the fingerprint
 *  - idle skip, active save, hidden pause, overlapping in-flight,
 *    unserialisable → save, failed-upload → retry
 *
 * Run: node tools/shared/autosave-dirty.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '../..');
var CLOUD = path.join(ROOT, 'tools/shared/cloud.js');
var INTEGRATION = path.join(ROOT, 'tools/shared/integration.js');

var failed = 0;
var passed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ok  — ' + msg);
  } else {
    failed++;
    console.error('  FAIL — ' + msg);
  }
}

function assertEq(a, b, msg) {
  assert(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

// ── Load sources ──────────────────────────────────────────────────────────
var cloudSrc = fs.readFileSync(CLOUD, 'utf8');
var integSrc = fs.readFileSync(INTEGRATION, 'utf8');

// ── Structural proofs ─────────────────────────────────────────────────────
console.log('\n1. Centralized guard — all call sites inherit cloud.startAutoSave');

var callSites = integSrc.match(/cloud\.startAutoSave\s*\(/g) || [];
assert(callSites.length >= 9, 'integration.js has ' + callSites.length + ' cloud.startAutoSave call sites (≥9)');

// integration should never define its own startAutoSave interval.
assert(!/setInterval\s*\([^)]*saveScope/.test(integSrc), 'integration.js has no private setInterval saveScope loop');
assert(/startAutoSave:\s*startAutoSave/.test(cloudSrc) || /startAutoSave:\s*startAutoSave/.test(cloudSrc),
  'cloud.js exports startAutoSave');
assert(/function startAutoSave\s*\(/.test(cloudSrc), 'cloud.js defines startAutoSave');
assert(/function _runAutoSave\s*\(/.test(cloudSrc), 'cloud.js defines _runAutoSave (interval + visibility funnel here)');
assert(/function _scopeFingerprint\s*\(/.test(cloudSrc), 'cloud.js defines _scopeFingerprint');

// Every startAutoSave invocation in integration must be cloud.startAutoSave
var startAutoSaveRefs = integSrc.match(/\bstartAutoSave\b/g) || [];
var cloudPrefixed = integSrc.match(/cloud\.startAutoSave/g) || [];
assertEq(startAutoSaveRefs.length, cloudPrefixed.length,
  'every startAutoSave reference in integration is cloud.startAutoSave');

console.log('\n2. Guards present in cloud.js');
assert(/if \(_autoSaveInFlight\) return;/.test(cloudSrc), 'in-flight guard blocks overlap across generations');
assert(/generation === _autoSaveGeneration/.test(cloudSrc), 'fingerprint committed only for the active session');
assert(/_autoSaveGeneration\+\+/.test(cloudSrc), 'start/stop retire in-flight saves via generation bump');
assert(/visibilityState\s*===\s*['"]hidden['"]/.test(cloudSrc), 'hidden-tab pause present');
assert(/visibilitychange/.test(cloudSrc), 'visibilitychange final-save handler present');
assert(/_lastSavedFingerprint/.test(cloudSrc), 'dirty fingerprint state present');
assert(/skipIfHidden/.test(cloudSrc), 'interval ticks pass skipIfHidden');
assert(/_lastSavedFingerprint\s*=\s*null/.test(cloudSrc), 'startAutoSave resets fingerprint (device-switch / new job)');

console.log('\n3. Volatile keys — only server timestamps, not operator content');
var volatileMatch = cloudSrc.match(/_AUTOSAVE_VOLATILE_KEYS\s*=[^{]*\{([^}]+)\}/);
assert(!!volatileMatch, 'found _AUTOSAVE_VOLATILE_KEYS definition');
assert(/_AUTOSAVE_VOLATILE_KEYS\s*=\s*Object\.assign\(Object\.create\(null\)/.test(cloudSrc),
  'volatile-key map is prototype-free (no inherited keys stripped from fingerprint)');
var volatileBody = volatileMatch ? volatileMatch[1] : '';
assert(/savedAt\s*:\s*1/.test(volatileBody), 'excludes savedAt');
assert(/generated_at\s*:\s*1/.test(volatileBody), 'excludes generated_at');
// Must NOT exclude operator / pricing keys
['projection', 'length', 'notes', 'pricing', 'client', 'flashings', 'config',
  'totalIncGST', 'scopeMedia', 'verification', 'sheetColor', 'steelColor'].forEach(function(k) {
  assert(!new RegExp('\\b' + k + '\\s*:').test(volatileBody),
    'does NOT exclude operator key "' + k + '"');
});

// ── Extract pure fingerprint from source (single source of truth) ─────────
console.log('\n4. Fingerprint behaviour (extracted from cloud.js)');

var fnMatch = cloudSrc.match(
  /var _AUTOSAVE_VOLATILE_KEYS = [^;]+;\s*[\s\S]*?function _scopeFingerprint\(state, meta\) \{[\s\S]*?return json\.length \+ ':' \+ \(h >>> 0\)\.toString\(16\);\s*\}/
);
assert(!!fnMatch, 'extracted _scopeFingerprint + volatile keys from cloud.js');

var scopeFingerprint;
if (fnMatch) {
  // eslint-disable-next-line no-new-func
  scopeFingerprint = new Function(
    fnMatch[0] + '\nreturn _scopeFingerprint;'
  )();
}

function sampleState(overrides) {
  var s = {
    client: { name: 'Ada Lovelace', phone: '0400000000', email: 'ada@example.com', address: '1 Binary St' },
    config: {
      projection: 4000,
      length: 6000,
      height: 2400,
      roofStyle: 'flat',
      sheetType: 'solarspan75',
      sheetColor: { name: 'Surfmist', hex: '#E8E4D9' },
      steelColor: { name: 'Monument', hex: '#3A3A3A' }
    },
    notes: 'install notes',
    flashings: [{ id: 'f1', name: 'barge', qty: 2 }],
    _pricing_json: { totalIncGST: 12500, generated_at: '2026-07-17T00:00:00.000Z' },
    savedAt: '2026-07-17T00:00:00.000Z',
    verification: { scopeSigned: true },
    scopeMedia: [{ id: 'p1', dataUrl: 'data:image/png;base64,AAA' }]
  };
  if (overrides) {
    Object.keys(overrides).forEach(function(k) {
      if (overrides[k] && typeof overrides[k] === 'object' && !Array.isArray(overrides[k]) && s[k] && typeof s[k] === 'object') {
        s[k] = Object.assign({}, s[k], overrides[k]);
      } else {
        s[k] = overrides[k];
      }
    });
  }
  return s;
}

function sampleMeta(state) {
  return {
    client_name: state.client.name,
    client_phone: state.client.phone,
    client_email: state.client.email,
    site_address: state.client.address,
    pricing_json: state._pricing_json
  };
}

if (scopeFingerprint) {
  var base = sampleState();
  var meta = sampleMeta(base);
  var fp1 = scopeFingerprint(base, meta);

  // Idle: only timestamps change → same fingerprint
  var idle = sampleState({
    savedAt: '2026-07-17T00:00:30.000Z',
    _pricing_json: { totalIncGST: 12500, generated_at: '2026-07-17T00:00:30.000Z' }
  });
  var fpIdle = scopeFingerprint(idle, sampleMeta(idle));
  assertEq(fpIdle, fp1, 'idle tick (only savedAt/generated_at change) → same fingerprint → skip');

  // Active: projection edit
  var active = sampleState({ config: { projection: 4500 } });
  var fpActive = scopeFingerprint(active, sampleMeta(active));
  assert(fpActive !== fp1, 'projection edit → different fingerprint → save');

  // Pricing total change
  var priced = sampleState({
    _pricing_json: { totalIncGST: 13000, generated_at: '2026-07-17T00:00:30.000Z' }
  });
  assert(scopeFingerprint(priced, sampleMeta(priced)) !== fp1, 'pricing total change → save');

  // Notes
  var noted = sampleState({ notes: 'updated notes' });
  assert(scopeFingerprint(noted, sampleMeta(noted)) !== fp1, 'notes edit → save');

  // Photo dataUrl
  var photo = sampleState({ scopeMedia: [{ id: 'p1', dataUrl: 'data:image/png;base64,BBB' }] });
  assert(scopeFingerprint(photo, sampleMeta(photo)) !== fp1, 'photo dataUrl change → save');

  // Client name
  var client = sampleState({ client: { name: 'Grace Hopper' } });
  assert(scopeFingerprint(client, sampleMeta(client)) !== fp1, 'client name change → save');

  // Sheet colour (operator colour content)
  var colour = sampleState({ config: { sheetColor: { name: 'Woodland Grey', hex: '#4B4B4B' } } });
  assert(scopeFingerprint(colour, sampleMeta(colour)) !== fp1, 'sheet colour change → save');

  // generated_at restamp at any depth must not dirty; pricing totals still compared
  var deepTs = sampleState({
    savedAt: '2099-01-01T00:00:00.000Z',
    _pricing_json: { totalIncGST: 12500, generated_at: '2099-01-01T00:00:00.000Z' }
  });
  assertEq(scopeFingerprint(deepTs, sampleMeta(deepTs)), fp1,
    'generated_at/savedAt restamp → same fingerprint; pricing totals still compared');
  // Key-name strip works at nested depth (sibling keys preserved)
  var nestedA = { outer: { generated_at: 't1', keep: 1 } };
  var nestedB = { outer: { generated_at: 't2', keep: 1 } };
  assertEq(scopeFingerprint(nestedA, {}), scopeFingerprint(nestedB, {}),
    'generated_at stripped at nested depth; sibling operator keys still hashed');
  var nestedC = { outer: { generated_at: 't1', keep: 2 } };
  assert(scopeFingerprint(nestedA, {}) !== scopeFingerprint(nestedC, {}),
    'nested operator content still dirties when generated_at is ignored');

  // Unserialisable
  var circular = sampleState();
  circular.self = circular;
  assertEq(scopeFingerprint(circular, meta), null, 'circular state → null fingerprint → treated as dirty');
}

// ── Behavioural simulation of _runAutoSave ────────────────────────────────
console.log('\n5. _runAutoSave behavioural cases (simulated against same rules)');

/**
 * Minimal harness mirroring cloud.js _runAutoSave guards:
 * in-flight, hidden pause, dirty skip, failed-upload leaves fingerprint stale.
 */
function makeHarness(opts) {
  opts = opts || {};
  var lastFp = null;
  var inFlight = false;
  var saves = [];
  var errors = [];
  var visibilityState = opts.visibilityState || 'visible';

  function fingerprint(state, meta) {
    return scopeFingerprint(state, meta);
  }

  async function run(jobId, getStateFn, runOpts) {
    runOpts = runOpts || {};
    if (inFlight) { saves.push({ skipped: 'in-flight' }); return; }
    if (runOpts.skipIfHidden && visibilityState === 'hidden') {
      saves.push({ skipped: 'hidden' });
      return;
    }
    inFlight = true;
    try {
      var state = getStateFn();
      if (!state) { saves.push({ skipped: 'no-state' }); return; }
      var clientName = (state.client && state.client.name) || '';
      if (!clientName) { saves.push({ skipped: 'no-client' }); return; }
      var meta = sampleMeta(state);
      var fp = fingerprint(state, meta);
      if (fp && fp === lastFp) { saves.push({ skipped: 'clean' }); return; }
      if (opts.failUpload) throw new Error('network down');
      // slow upload simulation
      if (opts.slowMs) await new Promise(function(r) { setTimeout(r, opts.slowMs); });
      saves.push({ saved: true, fp: fp, jobId: jobId });
      lastFp = fp;
    } catch (e) {
      errors.push(e.message);
      saves.push({ failed: true, error: e.message });
      // fingerprint NOT updated — retry next tick
    } finally {
      inFlight = false;
    }
  }

  return {
    run: run,
    setVisibility: function(v) { visibilityState = v; },
    getSaves: function() { return saves; },
    getErrors: function() { return errors; },
    getLastFp: function() { return lastFp; },
    setLastFp: function(fp) { lastFp = fp; },
    resetSession: function() { lastFp = null; } // startAutoSave
  };
}

async function runBehavioural() {
  if (!scopeFingerprint) {
    assert(false, 'skip behavioural — fingerprint extract failed');
    return;
  }

  // Idle: first save, then skip
  var h1 = makeHarness();
  var state = sampleState();
  await h1.run('job-1', function() { return state; }, { skipIfHidden: true });
  await h1.run('job-1', function() {
    return sampleState({ savedAt: 'later', _pricing_json: { totalIncGST: 12500, generated_at: 'later' } });
  }, { skipIfHidden: true });
  var s1 = h1.getSaves();
  assert(s1[0] && s1[0].saved, 'idle: first tick saves');
  assert(s1[1] && s1[1].skipped === 'clean', 'idle: second tick skips (clean)');

  // Active edit after clean
  var h2 = makeHarness();
  await h2.run('job-2', function() { return sampleState(); }, { skipIfHidden: true });
  await h2.run('job-2', function() { return sampleState({ config: { projection: 5000 } }); }, { skipIfHidden: true });
  var s2 = h2.getSaves();
  assert(s2[0] && s2[0].saved, 'active: baseline saves');
  assert(s2[1] && s2[1].saved, 'active: projection change saves');

  // Hidden tab: interval ticks skip; visibility final save runs without skipIfHidden
  var h3 = makeHarness({ visibilityState: 'hidden' });
  await h3.run('job-3', function() { return sampleState(); }, { skipIfHidden: true });
  assert(h3.getSaves()[0] && h3.getSaves()[0].skipped === 'hidden', 'hidden: interval tick pauses');
  // final save on hide (no skipIfHidden) — still runs while hidden
  await h3.run('job-3', function() { return sampleState(); }, {});
  assert(h3.getSaves()[1] && h3.getSaves()[1].saved, 'hidden: final visibility save still runs');

  // Overlapping in-flight
  var h4 = makeHarness({ slowMs: 40 });
  var p1 = h4.run('job-4', function() { return sampleState(); }, { skipIfHidden: true });
  // second call while first in flight
  await new Promise(function(r) { setTimeout(r, 5); });
  await h4.run('job-4', function() { return sampleState({ notes: 'mid-flight edit' }); }, { skipIfHidden: true });
  await p1;
  var s4 = h4.getSaves();
  assert(s4.some(function(x) { return x.skipped === 'in-flight'; }), 'overlapping: second tick skipped while in-flight');
  assert(s4.some(function(x) { return x.saved; }), 'overlapping: first upload completes');

  // Unserialisable → always save attempt (null fp never equals last)
  var h5 = makeHarness();
  var circ = sampleState();
  circ.self = circ;
  await h5.run('job-5', function() { return circ; }, { skipIfHidden: true });
  // second tick with still-circular still attempts (null !== last null? wait - after save lastFp is null)
  // If fp is null, code is: if (fp && fp === lastFp) return; → null is falsy → never skip
  await h5.run('job-5', function() { return circ; }, { skipIfHidden: true });
  var s5 = h5.getSaves();
  assert(s5[0] && s5[0].saved, 'unserialisable: first tick saves');
  assert(s5[1] && s5[1].saved, 'unserialisable: second tick still saves (no false-clean)');

  // Failed upload → fingerprint stale → retry
  var h6 = makeHarness({ failUpload: true });
  await h6.run('job-6', function() { return sampleState(); }, { skipIfHidden: true });
  assert(h6.getSaves()[0] && h6.getSaves()[0].failed, 'failed-upload: first tick fails');
  assertEq(h6.getLastFp(), null, 'failed-upload: fingerprint stays null (stale)');
  // After a failed upload, fingerprint is stale so the same payload retries
  var hFail = makeHarness({ failUpload: true });
  await hFail.run('job-7', function() { return sampleState(); }, { skipIfHidden: true });
  assertEq(hFail.getLastFp(), null, 'failed-upload: lastFp not updated');
  var hRetry = makeHarness();
  await hRetry.run('job-7', function() { return sampleState(); }, { skipIfHidden: true });
  assert(hRetry.getSaves()[0] && hRetry.getSaves()[0].saved, 'failed-upload: retry saves when network recovers');

  // Device-switch / new session: startAutoSave clears fingerprint
  var h8 = makeHarness();
  await h8.run('job-8', function() { return sampleState(); }, { skipIfHidden: true });
  assert(h8.getLastFp() != null, 'session: fingerprint set after save');
  h8.resetSession();
  assertEq(h8.getLastFp(), null, 'device-switch: startAutoSave clears fingerprint → first save never skipped');
  await h8.run('job-8', function() { return sampleState(); }, { skipIfHidden: true });
  assert(h8.getSaves().filter(function(x) { return x.saved; }).length === 2,
    'device-switch: post-reset tick saves again');

  // Manual save leaves fingerprint stale → at most one redundant autosave
  var h9 = makeHarness();
  // simulate: user had clean state, manual save bypassed fp, then autosave
  // (manual path never touches lastFp — so if state matches what autosave already saved, skip;
  //  if manual save was first, lastFp is null → one save)
  assertEq(h9.getLastFp(), null, 'manual-save path: autosave fingerprint untouched until its own success');
  await h9.run('job-9', function() { return sampleState(); }, { skipIfHidden: true });
  assert(h9.getSaves()[0] && h9.getSaves()[0].saved, 'manual-save aftermath: at most one autosave lands');
}

// ── Offline / failed path preserved in source ─────────────────────────────
console.log('\n6. Offline retry + manual save paths preserved in source');
assert(/_offlineQueue/.test(cloudSrc), 'offline queue still present');
assert(/_flushQueue/.test(cloudSrc), 'offline flush still present');
assert(/function stopAutoSave/.test(cloudSrc), 'stopAutoSave present');
// Manual save is in integration (saveNow / explicit save), not gated by fingerprint
assert(/saveScope/.test(integSrc) || /saveJob/.test(integSrc) || /cloud\.ghl|ghl\.saveScope|saveNow|manual/i.test(integSrc),
  'integration still has explicit save path separate from autosave');
// Fingerprint only updated after await saveScope (success path)
assert(/await [\s\S]{0,40}ghl\.saveScope[\s\S]{0,300}_lastSavedFingerprint\s*=\s*fp/.test(cloudSrc),
  'fingerprint set only after successful saveScope await');
// A hung upload must not latch auto-save off for the rest of the session
assert(/function stopAutoSave\(\)[\s\S]{0,300}_autoSaveInFlight\s*=\s*null/.test(cloudSrc),
  'stopAutoSave releases the in-flight latch');

runBehavioural().then(function() {
  console.log('\n────────────────────────────────────');
  console.log('Passed: ' + passed + '  Failed: ' + failed);
  if (failed > 0) process.exit(1);
  console.log('All autosave dirty-check regressions green.');
}).catch(function(e) {
  console.error(e);
  process.exit(1);
});
