#!/usr/bin/env node
/**
 * Regression coverage for the patio quote-send repair (frontend/tool lane).
 *
 * Proves the four repaired contracts with FAKES only — zero live network:
 *   1. Persist-before-send + fail-closed ordering (single & multi).
 *   2. Idempotent retry — one stable key ⇒ ≤1 provider call + 1 release event.
 *   3. Explicit resend — new key + bumped version ⇒ one ADDITIONAL provider call.
 *   4. Multi-option fail-closed — any option failure ⇒ the email adapter is
 *      never called (no partial subset is emailed); full success ⇒ exactly one.
 *
 * Plus structural proofs that index.html wires the module and that
 * integration.js exposes the confirmable saveForSend() persist primitive.
 *
 * HARD SAFETY: global fetch is stubbed to THROW on any call. The orchestration
 * module performs no network I/O of its own (all effects are injected), so any
 * accidental real request fails the run immediately.
 *
 * Run: node tools/shared/quote-send.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '../..');
var QS = require(path.join(ROOT, 'tools/shared/quote-send.js'));

var failed = 0, passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.error('  FAIL — ' + msg); }
}
function assertEq(a, b, msg) {
  assert(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

// ── Network interception: any real fetch fails the run ──────────────────────
var fetchAttempts = 0;
global.fetch = function () {
  fetchAttempts++;
  throw new Error('LIVE NETWORK BLOCKED: quote-send tests must never call fetch');
};

// ── Fake collaborator factory ──────────────────────────────────────────────
function recorder() {
  var calls = [];
  return {
    calls: calls,
    log: function (name, extra) { calls.push(Object.assign({ step: name }, extra || {})); },
    steps: function () { return calls.map(function (c) { return c.step; }); },
    count: function (name) { return calls.filter(function (c) { return c.step === name; }).length; }
  };
}

function okSingleDeps(rec, over) {
  over = over || {};
  var base = {
    attempt: over.attempt || QS.createAttempt({ keygen: over.keygen }),
    getJobId: function () { return over.jobId || 'job-1'; },
    onStep: function () {},
    persist: async function () { rec.log('persist'); return over.persist ? over.persist() : { ok: true, jobId: over.jobId || 'job-1' }; },
    prepare: async function () { rec.log('prepare'); return over.prepare ? over.prepare() : { ok: true, data: { quoteNumber: 'Q-100', uploadUrl: 'u://pdf', documentId: 'doc-1', htmlUploadUrl: over.html ? 'u://html' : undefined, shareToken: 'tok', publicUrl: 'p://x' } }; },
    generatePdf: async function (a) { rec.log('pdf', { quoteNumber: a.quoteNumber }); return over.generatePdf ? over.generatePdf(a) : { ok: true, blob: { size: 1234 } }; },
    uploadPdf: async function (a) { rec.log('upload_pdf', { url: a.url, hasBlob: !!a.blob }); return over.uploadPdf ? over.uploadPdf(a) : { ok: true }; },
    uploadHtml: async function (a) { rec.log('upload_html', { url: a.url }); return over.uploadHtml ? over.uploadHtml(a) : { ok: true }; },
    send: async function (a) { rec.log('send', { documentId: a.documentId, key: a.idempotencyKey }); return over.send ? over.send(a) : { ok: true, data: { view_url: 'v://x' } }; }
  };
  return base;
}

(async function run() {
  // ── 1. Persist-before-send ordering (single) ──────────────────────────────
  console.log('\n1. Single-send ordering: persist → prepare → pdf → upload → (html) → send');
  {
    var rec = recorder();
    var res = await QS.runSingleSend(okSingleDeps(rec, { html: true }));
    assert(res.ok, 'single send succeeds on the happy path');
    assertEq(rec.steps().join(','), 'persist,prepare,pdf,upload_pdf,upload_html,send',
      'steps run in the persist-first order');
    // persist strictly precedes prepare and send
    assert(rec.steps().indexOf('persist') === 0, 'persist is the FIRST step (before any preparation)');
    assert(rec.steps().indexOf('persist') < rec.steps().indexOf('prepare'), 'persist precedes prepare');
    assert(rec.steps().indexOf('persist') < rec.steps().indexOf('send'), 'persist precedes send');
    // PDF gets the reserved quote number; upload gets the blob + url
    var pdfCall = rec.calls.find(function (c) { return c.step === 'pdf'; });
    assertEq(pdfCall.quoteNumber, 'Q-100', 'PDF generation receives the reserved quote number');
    var upCall = rec.calls.find(function (c) { return c.step === 'upload_pdf'; });
    assert(upCall.hasBlob && upCall.url === 'u://pdf', 'PDF upload receives blob + signed url');
  }

  // ── 2. Fail-closed BEFORE preparation when persist fails ───────────────────
  console.log('\n2. Fail-closed: persist failure blocks all downstream stages');
  {
    var rec = recorder();
    var res = await QS.runSingleSend(okSingleDeps(rec, { persist: function () { return { ok: false, error: 'cloud down' }; } }));
    assert(!res.ok, 'persist failure ⇒ overall failure');
    assertEq(res.stage, 'persist', 'failure stage is named "persist" (UI can name the save stage)');
    assertEq(rec.count('prepare'), 0, 'prepare NOT called after persist failure');
    assertEq(rec.count('pdf'), 0, 'PDF NOT generated after persist failure');
    assertEq(rec.count('upload_pdf'), 0, 'PDF NOT uploaded after persist failure');
    assertEq(rec.count('send'), 0, 'send NOT called after persist failure — no communication');
  }

  // ── 2b. Persist confirms a stable job id ──────────────────────────────────
  console.log('\n2b. Persist must confirm a job id (never send against a missing/changed id)');
  {
    var rec = recorder();
    var res = await QS.runSingleSend({
      getJobId: function () { return null; }, // no confirmed id
      persist: async function () { rec.log('persist'); return { ok: true }; },
      prepare: async function () { rec.log('prepare'); return { ok: true, data: {} }; },
      generatePdf: async function () { rec.log('pdf'); return { ok: true, blob: {} }; },
      uploadPdf: async function () { rec.log('upload_pdf'); return { ok: true }; },
      send: async function () { rec.log('send'); return { ok: true }; }
    });
    assert(!res.ok && res.stage === 'persist', 'no confirmed job id ⇒ fail closed at persist');
    assertEq(rec.count('send'), 0, 'send NOT called when job id unconfirmed');
  }

  // ── 3. Prepare failure preserves stage + HTTP status; no send ─────────────
  console.log('\n3. Prepare failure: staged error preserved, no PDF/upload/send');
  {
    var rec = recorder();
    var res = await QS.runSingleSend(okSingleDeps(rec, { prepare: function () { return { ok: false, status: 400, error: 'Unknown action' }; } }));
    assert(!res.ok, 'prepare failure ⇒ overall failure');
    assertEq(res.stage, 'prepare', 'failure stage is "prepare"');
    assertEq(res.status, 400, 'HTTP status 400 preserved from prepare');
    assertEq(res.error, 'Unknown action', 'backend error message preserved');
    assertEq(rec.count('pdf'), 0, 'no PDF after prepare failure');
    assertEq(rec.count('send'), 0, 'no send after prepare failure');
  }

  // ── 3b. PDF-upload failure ⇒ no send ──────────────────────────────────────
  console.log('\n3b. PDF upload failure blocks send');
  {
    var rec = recorder();
    var res = await QS.runSingleSend(okSingleDeps(rec, { uploadPdf: function () { return { ok: false, status: 500, error: 'upload down' }; } }));
    assert(!res.ok && res.stage === 'upload_pdf', 'upload failure ⇒ fail at upload_pdf');
    assertEq(rec.count('send'), 0, 'no send after PDF upload failure');
  }

  // ── 4. Optional HTML is non-fatal (PDF fallback) ──────────────────────────
  console.log('\n4. Interactive HTML is optional/non-fatal');
  {
    var rec = recorder();
    var res = await QS.runSingleSend(okSingleDeps(rec, { html: true, uploadHtml: function () { return { ok: false, status: 502, error: 'html bucket missing' }; } }));
    assert(res.ok, 'HTML upload failure does NOT fail the send (PDF fallback)');
    assert(res.htmlWarning, 'a non-blocking HTML warning is recorded (never misreported as delivered)');
    assertEq(rec.count('send'), 1, 'email still sent after non-fatal HTML failure');
  }
  {
    var rec = recorder();
    var res = await QS.runSingleSend(okSingleDeps(rec, { html: false }));
    assert(res.ok, 'no htmlUploadUrl ⇒ PDF-only path still sends');
    assertEq(rec.count('upload_html'), 0, 'HTML upload skipped when backend omits htmlUploadUrl');
    assertEq(rec.count('send'), 1, 'email sent on PDF-only path');
  }

  // ── 5. Idempotent retry: one stable key ⇒ one provider call/release event ──
  console.log('\n5. Idempotency: retry of the SAME ambiguous attempt ⇒ ≤1 provider call');
  {
    // Fake idempotent backend keyed by idempotency key.
    var backend = { providerCalls: 0, releaseEvents: 0, seen: Object.create(null) };
    function fakeSend(a) {
      var k = a.idempotencyKey;
      if (backend.seen[k]) return { ok: true, data: { view_url: 'v://cached' } }; // dedup — no new side effect
      backend.providerCalls++;
      backend.releaseEvents++;
      backend.seen[k] = true;
      return { ok: true, data: { view_url: 'v://fresh' } };
    }
    var attempt = QS.createAttempt({ keygen: (function () { var n = 0; return function () { return 'fixed-key-1'; }; })() });

    var rec1 = recorder();
    // First send: backend records the release, but the CLIENT sees a timeout afterwards.
    var timedOut = false;
    var r1 = await QS.runSingleSend(okSingleDeps(rec1, {
      attempt: attempt,
      send: function (a) { var out = fakeSend(a); timedOut = true; throw new Error('client timeout after provider accepted'); }
    }));
    assert(!r1.ok && r1.stage === 'send', 'first attempt: client-visible send failure (ambiguous)');
    assert(timedOut, 'backend DID accept before the client timeout');

    // Retry reuses the SAME attempt (same key). Backend dedupes.
    var rec2 = recorder();
    var r2 = await QS.runSingleSend(okSingleDeps(rec2, { attempt: attempt, send: fakeSend }));
    assert(r2.ok, 'retry with the same key succeeds (idempotent)');
    assertEq(backend.providerCalls, 1, 'exactly ONE provider call across the ambiguous retry');
    assertEq(backend.releaseEvents, 1, 'exactly ONE release event across the ambiguous retry');
    assertEq(rec2.calls.find(function (c) { return c.step === 'send'; }).key, 'fixed-key-1', 'retry sends the SAME idempotency key');
  }

  // ── 6. Explicit resend: new key + bumped version ⇒ one ADDITIONAL call ─────
  console.log('\n6. Explicit resend ⇒ fresh version + one additional provider call');
  {
    var backend = { providerCalls: 0, releaseEvents: 0, seen: Object.create(null) };
    function fakeSend(a) {
      var k = a.idempotencyKey;
      if (backend.seen[k]) return { ok: true, data: {} };
      backend.providerCalls++; backend.releaseEvents++; backend.seen[k] = true;
      return { ok: true, data: {} };
    }
    var first = QS.createAttempt({ keygen: function () { return 'send-key'; } });
    var r1 = await QS.runSingleSend(okSingleDeps(recorder(), { attempt: first, send: fakeSend }));
    assert(r1.ok && backend.providerCalls === 1, 'initial send ⇒ 1 provider call, version 1');
    assertEq(first.version, 1, 'first release is version 1');

    var resend = QS.nextResendAttempt(first, { keygen: function () { return 'resend-key'; } });
    assert(resend.idempotencyKey !== first.idempotencyKey, 'resend allocates a NEW idempotency key');
    assertEq(resend.version, 2, 'resend bumps the immutable version to 2');
    assertEq(resend.kind, 'resend', 'resend attempt is marked kind=resend');

    var recR = recorder();
    var r2 = await QS.runSingleSend(okSingleDeps(recR, { attempt: resend, send: fakeSend }));
    assert(r2.ok, 'resend succeeds');
    assertEq(backend.providerCalls, 2, 'resend produces exactly ONE additional provider call');
    var sendCall = recR.calls.find(function (c) { return c.step === 'send'; });
    assertEq(sendCall.key, 'resend-key', 'resend uses the new key');
  }

  // ── 7. Multi fail-closed: any option failure ⇒ ZERO email ─────────────────
  console.log('\n7. Multi-option fail-closed: any option failure ⇒ email adapter never called');
  {
    var opts = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];
    var rec = recorder();
    var persisted = null;
    var res = await QS.runMultiSend({
      options: opts,
      attempt: QS.createAttempt({ keygen: function () { return 'mk'; } }),
      getJobId: function () { return 'job-1'; },
      persistAll: async function (a) { rec.log('persistAll'); persisted = a.options; return { ok: true, jobId: 'job-1' }; },
      prepareOption: async function (o) { rec.log('prepare:' + o.label); if (o.label === 'B') return { ok: false, status: 500, error: 'prep B failed' }; return { ok: true, data: { uploadUrl: 'u', documentId: 'd-' + o.label } }; },
      generateOptionPdf: async function (o) { rec.log('pdf:' + o.label); return { ok: true, blob: {} }; },
      uploadPdf: async function () { rec.log('upload'); return { ok: true }; },
      send: async function () { rec.log('send'); return { ok: true }; }
    });
    assert(!res.ok, 'a failed option ⇒ whole multi-send fails');
    assertEq(res.stage, 'prepare', 'failure reported at the prepare stage');
    assertEq(res.option, 'B', 'the failing option is identified');
    assertEq(rec.count('persistAll'), 1, 'all options persisted exactly once BEFORE preparation');
    assert(persisted && persisted.length === 3, 'persistAll received ALL three options');
    assertEq(rec.count('send'), 0, 'email adapter called ZERO times — no partial subset sent');
  }

  // ── 8. Multi full success ⇒ exactly one email ─────────────────────────────
  console.log('\n8. Multi-option full success ⇒ email adapter called exactly once');
  {
    var opts = [{ label: 'A' }, { label: 'B' }];
    var rec = recorder();
    var sendArg = null;
    var res = await QS.runMultiSend({
      options: opts,
      attempt: QS.createAttempt({ keygen: function () { return 'mk2'; } }),
      getJobId: function () { return 'job-1'; },
      persistAll: async function () { rec.log('persistAll'); return { ok: true, jobId: 'job-1' }; },
      prepareOption: async function (o) { rec.log('prepare:' + o.label); return { ok: true, data: { uploadUrl: 'u', documentId: 'd-' + o.label } }; },
      generateOptionPdf: async function () { rec.log('pdf'); return { ok: true, blob: {} }; },
      uploadPdf: async function () { rec.log('upload'); return { ok: true }; },
      send: async function (a) { rec.log('send'); sendArg = a; return { ok: true, data: {} }; }
    });
    assert(res.ok, 'all options prepared ⇒ multi-send succeeds');
    assertEq(rec.count('send'), 1, 'exactly ONE email for the whole multi-option quote');
    assertEq(sendArg.documentId, 'd-A', 'email references the first prepared document');
    assertEq(sendArg.idempotencyKey, 'mk2', 'multi email carries the idempotency key');
    assertEq(res.documents.length, 2, 'both option documents prepared before the single send');
  }

  // ── 8b. Multi persist failure ⇒ nothing prepared, zero email ──────────────
  console.log('\n8b. Multi persist failure ⇒ no preparation, no email');
  {
    var rec = recorder();
    var res = await QS.runMultiSend({
      options: [{ label: 'A' }, { label: 'B' }],
      persistAll: async function () { rec.log('persistAll'); return { ok: false, error: 'save down' }; },
      prepareOption: async function () { rec.log('prepare'); return { ok: true, data: {} }; },
      generateOptionPdf: async function () { rec.log('pdf'); return { ok: true, blob: {} }; },
      uploadPdf: async function () { rec.log('upload'); return { ok: true }; },
      send: async function () { rec.log('send'); return { ok: true }; }
    });
    assert(!res.ok && res.stage === 'persist', 'persist failure ⇒ fail closed at persist');
    assertEq(rec.count('prepare'), 0, 'no option prepared when persist fails');
    assertEq(rec.count('send'), 0, 'no email when persist fails');
  }

  // ── 8c. Bundle send: persist-all → ONE prepare/pdf/upload/send ─────────────
  console.log('\n8c. Bundle send: one combined document, one email (persist-first order)');
  {
    var rec = recorder();
    var persistedBuilds = null;
    var genArg = null;
    var res = await QS.runBundleSend({
      builds: [{ label: 'Build A' }, { label: 'Build B' }, { label: 'Build C' }],
      attempt: QS.createAttempt({ keygen: function () { return 'bk' } }),
      getJobId: function () { return 'job-1'; },
      persistAll: async function (a) { rec.log('persistAll'); persistedBuilds = a.builds; return { ok: true, jobId: 'job-1' }; },
      prepare: async function () { rec.log('prepare'); return { ok: true, data: { quoteNumber: 'Q-9', uploadUrl: 'u://pdf', htmlUploadUrl: 'u://html', documentId: 'doc-combined' } }; },
      generatePdf: async function (a) { rec.log('pdf'); genArg = a; return { ok: true, blob: { size: 42 } }; },
      uploadPdf: async function () { rec.log('upload_pdf'); return { ok: true }; },
      uploadHtml: async function () { rec.log('upload_html'); return { ok: true }; },
      send: async function (a) { rec.log('send', { documentId: a.documentId, key: a.idempotencyKey }); return { ok: true, data: { view_url: 'v://combined' } }; }
    });
    assert(res.ok, 'bundle send succeeds on the happy path');
    assertEq(rec.steps().join(','), 'persistAll,prepare,pdf,upload_pdf,upload_html,send', 'ONE of each stage, persist-first');
    assertEq(rec.count('prepare'), 1, 'exactly ONE prepare (not N)');
    assertEq(rec.count('pdf'), 1, 'exactly ONE combined PDF generated (not N)');
    assertEq(rec.count('upload_pdf'), 1, 'exactly ONE upload');
    assertEq(rec.count('send'), 1, 'exactly ONE email for the whole bundle');
    assert(persistedBuilds && persistedBuilds.length === 3, 'persistAll received ALL three builds before preparation');
    assert(genArg && genArg.builds && genArg.builds.length === 3, 'PDF generator receives all builds to assemble one document');
    assertEq(genArg.quoteNumber, 'Q-9', 'PDF generator receives the reserved quote number');
    assertEq(rec.calls.find(function (c) { return c.step === 'send'; }).documentId, 'doc-combined', 'email references the single combined document');
    assertEq(rec.calls.find(function (c) { return c.step === 'send'; }).key, 'bk', 'bundle email carries the idempotency key');
  }

  // ── 8d. Bundle fail-closed: PDF-assembly failure ⇒ no email ────────────────
  console.log('\n8d. Bundle fail-closed: combined-PDF failure blocks the send');
  {
    var rec = recorder();
    var res = await QS.runBundleSend({
      builds: [{ label: 'A' }, { label: 'B' }],
      getJobId: function () { return 'job-1'; },
      persistAll: async function () { rec.log('persistAll'); return { ok: true, jobId: 'job-1' }; },
      prepare: async function () { rec.log('prepare'); return { ok: true, data: { uploadUrl: 'u', documentId: 'd' } }; },
      generatePdf: async function () { rec.log('pdf'); return { ok: false, error: 'render capture failed for Build B' }; },
      uploadPdf: async function () { rec.log('upload_pdf'); return { ok: true }; },
      send: async function () { rec.log('send'); return { ok: true }; }
    });
    assert(!res.ok && res.stage === 'pdf', 'combined-PDF failure ⇒ fail closed at pdf');
    assertEq(rec.count('upload_pdf'), 0, 'no upload after PDF-assembly failure');
    assertEq(rec.count('send'), 0, 'email adapter NEVER called — nothing partial sent');
  }

  // ── 8e. Bundle persist failure ⇒ nothing prepared, zero email ──────────────
  console.log('\n8e. Bundle persist failure ⇒ no preparation, no email');
  {
    var rec = recorder();
    var res = await QS.runBundleSend({
      builds: [{ label: 'A' }, { label: 'B' }],
      persistAll: async function () { rec.log('persistAll'); return { ok: false, error: 'save down' }; },
      prepare: async function () { rec.log('prepare'); return { ok: true, data: {} }; },
      generatePdf: async function () { rec.log('pdf'); return { ok: true, blob: {} }; },
      uploadPdf: async function () { rec.log('upload_pdf'); return { ok: true }; },
      send: async function () { rec.log('send'); return { ok: true }; }
    });
    assert(!res.ok && res.stage === 'persist', 'persist failure ⇒ fail closed at persist');
    assertEq(rec.count('prepare'), 0, 'nothing prepared when persist fails');
    assertEq(rec.count('send'), 0, 'no email when persist fails');
  }

  // ── 8f. Bundle HTML upload is non-fatal (PDF fallback) ─────────────────────
  console.log('\n8f. Bundle: interactive HTML failure does not block the send');
  {
    var rec = recorder();
    var res = await QS.runBundleSend({
      builds: [{ label: 'A' }, { label: 'B' }],
      getJobId: function () { return 'job-1'; },
      persistAll: async function () { rec.log('persistAll'); return { ok: true, jobId: 'job-1' }; },
      prepare: async function () { rec.log('prepare'); return { ok: true, data: { uploadUrl: 'u', htmlUploadUrl: 'h', documentId: 'd' } }; },
      generatePdf: async function () { rec.log('pdf'); return { ok: true, blob: {} }; },
      uploadPdf: async function () { rec.log('upload_pdf'); return { ok: true }; },
      uploadHtml: async function () { rec.log('upload_html'); return { ok: false, status: 502, error: 'html bucket missing' }; },
      send: async function () { rec.log('send'); return { ok: true, data: {} }; }
    });
    assert(res.ok, 'HTML upload failure does NOT fail the bundle send (PDF fallback)');
    assert(res.htmlWarning, 'a non-blocking HTML warning is recorded');
    assertEq(rec.count('send'), 1, 'combined email still sent after non-fatal HTML failure');
  }

  // ── 9. Idempotency-key helper properties ──────────────────────────────────
  console.log('\n9. Idempotency-key + attempt lifecycle');
  {
    var k1 = QS.generateIdempotencyKey();
    var k2 = QS.generateIdempotencyKey();
    assert(typeof k1 === 'string' && k1.length >= 16, 'generateIdempotencyKey returns a substantial string');
    assert(k1 !== k2, 'two generated keys differ');
    assertEq(QS.generateIdempotencyKey(function () { return 'inj'; }), 'inj', 'injected keygen is honoured');
    var a = QS.createAttempt({ jobId: 'j1' });
    assertEq(a.version, 1, 'default attempt version is 1');
    assertEq(a.kind, 'send', 'default attempt kind is send');
    assert(a.idempotencyKey, 'attempt carries an idempotency key');
  }

  // ── 10. No live network occurred ──────────────────────────────────────────
  console.log('\n10. Network safety');
  assertEq(fetchAttempts, 0, 'zero real fetch calls during module tests (all effects were faked)');

  // ── 11. Structural proofs over index.html + integration.js ────────────────
  console.log('\n11. Wiring proofs (index.html + integration.js source)');
  var indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var integSrc = fs.readFileSync(path.join(ROOT, 'tools/shared/integration.js'), 'utf8');

  assert(/<script src="tools\/shared\/quote-send\.js/.test(indexSrc), 'index.html loads tools/shared/quote-send.js');
  assert(/window\.SWQuoteSend\.runSingleSend\(/.test(indexSrc), 'executeSendQuote delegates to runSingleSend');
  assert(/window\.SWQuoteSend\.runBundleSend\(/.test(indexSrc), 'executeSendQuoteMulti delegates to runBundleSend (one combined document)');
  assert(/if \(window\._sqSending\)/.test(indexSrc) && /window\._sqSending = true/.test(indexSrc),
    'single-send has an in-flight (double-tap) guard');
  assert(/integ\.saveForSend\(\)/.test(indexSrc), 'send path persists via integration.saveForSend() before preparing');
  // The idempotency key MUST travel in the request body, never as an HTTP header:
  // the deployed send-quote CORS allow-list is 'Content-Type, Authorization, x-api-key',
  // so an 'Idempotency-Key' request header fails the browser preflight ("Failed to fetch")
  // and the email never sends. This guards the real-send fix (canary-verified 2026-08-19).
  assert(!/['"]Idempotency-Key['"]\s*:\s*a\.idempotencyKey/.test(indexSrc),
    'send requests must NOT carry an Idempotency-Key HTTP header (breaks CORS preflight — no email sent)');
  assert(/idempotency_key: a\.idempotencyKey/.test(indexSrc), 'send requests carry an idempotency_key body field');
  assert(/nextResendAttempt\(/.test(indexSrc), 'already-released quotes resend as a NEW version');
  // Bundle parity: the combined send MUST upload the interactive web quote, or the
  // client's "View Quote" acceptance page 404s and only PDF actions show (canary-verified
  // 2026-08-19). Guard the uploadHtml collaborator + the stash it reuses + the shared
  // accept/mobile-fit helpers that make the bundle web page behave like the single one.
  assert(/uploadHtml: async function \(a\) \{[\s\S]{0,700}buildMultiQuoteHTML\(/.test(indexSrc)
      || /uploadHtml: async function\(a\) \{[\s\S]{0,700}buildMultiQuoteHTML\(/.test(indexSrc),
    'bundle send deps include an uploadHtml collaborator that builds + uploads the combined web quote');
  assert(/window\._lastBundleQuoteParts = \{ job: job, builds: builds, imgs: imgs \}/.test(indexSrc),
    'bundle PDF generation stashes {job,builds,imgs} so uploadHtml reuses them (no re-capture)');
  assert(/function _swWebAcceptBlock\(opts, forPDF\)/.test(indexSrc) && /function _swWebFitScript\(forPDF\)/.test(indexSrc),
    'shared web-quote accept + mobile-fit helpers exist (used by single AND bundle web quotes)');
  // The old silent-skip of failed multi options must be gone.
  assert(!/prepare_quote failed for/.test(indexSrc), 'old silent multi-option skip warning removed');
  assert(!/console\.warn\('\[SendMulti\] prepare_quote failed[\s\S]*continue;/.test(indexSrc),
    'no silent "continue" past a failed option preparation');

  assert(/saveForSend:\s*async function/.test(integSrc), 'integration.js exposes saveForSend()');
  assert(/saveForSend[\s\S]{0,1200}cloud\.ghl\.saveScope\(/.test(integSrc), 'saveForSend persists via cloud.ghl.saveScope (save_scope contract)');
  assert(/saveForSend[\s\S]{0,1400}_jobId !== beforeId/.test(integSrc), 'saveForSend confirms the job id is unchanged');
  assert(/saveForSend[\s\S]{0,1600}return \{ ok: true, jobId: _jobId \}/.test(integSrc), 'saveForSend returns a definite success result');
  assert(/function _buildSaveMeta\(/.test(integSrc), 'integration.js factors _buildSaveMeta (shared save/saveForSend schema)');
  assert(/var meta = _buildSaveMeta\(state\)/.test(integSrc), 'save() reuses _buildSaveMeta so persisted schema matches saveForSend');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────');
  console.log('Passed: ' + passed + '  Failed: ' + failed);
  if (failed > 0) process.exit(1);
  console.log('All quote-send repair regressions green.');
})().catch(function (e) { console.error(e); process.exit(1); });
