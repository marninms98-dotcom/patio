// ════════════════════════════════════════════════════════════
// SecureWorks — Quote-Send Orchestration (tool-side)
//
// Pure, dependency-injected orchestration for the patio quote-send
// workflow. Every side effect (cloud persist, prepare, PDF gen, upload,
// email send) is supplied by the caller as a collaborator, so this module
// performs ZERO real network I/O and is fully testable in Node with fakes.
//
// It encodes the four repaired contracts (see
// data/patio-quote-send-repair/report.md + decisions-2026-07-30.md):
//   1. Persist-before-send — the current scope + pricing snapshot is
//      persisted to the cloud BEFORE prepare/send. If persistence fails,
//      the send FAILS CLOSED before any preparation call.
//   2. Idempotent retry — a retry of the same in-flight/ambiguous attempt
//      reuses one stable idempotency key, so an idempotent backend collapses
//      it to at most one provider call + one release event.
//   3. Explicit resend = new version — an explicit "Resend Quote" allocates
//      a fresh attempt (new key) AND bumps the immutable quote version.
//   4. Multi-option fail-closed — all option pricing is persisted first;
//      if ANY option fails preparation/upload the whole send fails closed
//      (the email adapter is never called — no partial subset is sent).
//
// index.html wires the real collaborators; the tests wire fakes/spies.
// ════════════════════════════════════════════════════════════
(function (root, factory) {
  'use strict';
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.SWQuoteSend = mod;
})(typeof self !== 'undefined' ? self
  : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ── Idempotency key ────────────────────────────────────────────────────
  // Secure-random by default; callers/tests may inject a deterministic keygen.
  // Never falls back to Math.random for a key — an ambiguous-retry guard that
  // could collide is worse than useless.
  function generateIdempotencyKey(keygen) {
    if (typeof keygen === 'function') return keygen();
    var c = (typeof crypto !== 'undefined') ? crypto
      : (typeof globalThis !== 'undefined' ? globalThis.crypto : undefined);
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    if (c && typeof c.getRandomValues === 'function') {
      var b = new Uint8Array(16);
      c.getRandomValues(b);
      var hex = Array.prototype.map.call(b, function (x) {
        return ('0' + x.toString(16)).slice(-2);
      }).join('');
      // RFC-4122-ish shape, good enough as a dedup token.
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16)
        + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    throw new Error('No secure RNG available for idempotency key');
  }

  // ── Attempt lifecycle ──────────────────────────────────────────────────
  // An "attempt" carries the stable idempotency key + immutable version for a
  // single send. A RETRY reuses the SAME attempt object (same key). A first
  // send or an explicit resend allocates a NEW attempt.
  function createAttempt(opts) {
    opts = opts || {};
    return {
      jobId: opts.jobId || null,
      idempotencyKey: opts.idempotencyKey || generateIdempotencyKey(opts.keygen),
      version: (typeof opts.version === 'number' && opts.version > 0) ? opts.version : 1,
      kind: opts.kind === 'resend' ? 'resend' : 'send',
      tries: 0
    };
  }

  // Explicit resend → a brand-new attempt: new key + version bumped past the
  // last released version. It NEVER reuses the prior key (it is a distinct,
  // intentional customer communication — an idempotent backend must not
  // collapse it into the previous release).
  function nextResendAttempt(prev, opts) {
    opts = opts || {};
    var prevVersion = (prev && typeof prev.version === 'number') ? prev.version : 0;
    return createAttempt({
      jobId: (prev && prev.jobId) || opts.jobId || null,
      version: prevVersion + 1,
      kind: 'resend',
      keygen: opts.keygen
    });
  }

  // ── Step helpers ───────────────────────────────────────────────────────
  // Normalise a collaborator's outcome. A collaborator may throw, return a
  // falsy/`{ok:false}` result, or return `{ok:true, ...payload}`.
  function _fail(stage, msg, extra) {
    var out = { ok: false, stage: stage, error: (msg == null ? 'Unknown error' : String(msg)) };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k]; } }
    return out;
  }

  async function _run(stage, fn) {
    var res;
    try {
      res = await fn();
    } catch (e) {
      return _fail(stage, (e && e.message) ? e.message : e, { status: (e && e.status) || null });
    }
    if (res && res.ok === false) {
      return _fail(stage, res.error || res.message || (res.status ? ('HTTP ' + res.status) : 'failed'),
        { status: res.status || null, data: res.data });
    }
    var ok = { ok: true, stage: stage };
    if (res && typeof res === 'object') { for (var k in res) { if (Object.prototype.hasOwnProperty.call(res, k)) ok[k] = res[k]; } }
    return ok;
  }

  // ── Single-option send ─────────────────────────────────────────────────
  // deps:
  //   attempt        : an attempt from createAttempt/nextResendAttempt (required for
  //                    retry-idempotency; auto-created if omitted)
  //   persist()      : persist current scope + pricing to cloud → {ok, jobId} | throws
  //   getJobId()     : current cloud job id (optional — used to confirm stability)
  //   prepare({attempt})            : reserve quote number/document → {ok, data:{quoteNumber,uploadUrl,htmlUploadUrl,documentId,shareToken,publicUrl}}
  //   generatePdf({quoteNumber,prepData}) : → {ok, blob} | throws
  //   uploadPdf({url, blob})        : → {ok} | throws
  //   uploadHtml({url, prepData})   : optional → {ok} (failure is non-fatal)
  //   send({documentId, idempotencyKey, attempt}) : → {ok, data:{view_url}} | throws
  //   onStep(stage, detail)         : progress callback (optional)
  async function runSingleSend(deps) {
    deps = deps || {};
    var onStep = deps.onStep || function () {};
    var attempt = deps.attempt || createAttempt({ jobId: deps.getJobId && deps.getJobId(), keygen: deps.keygen });

    // 1 — PERSIST BEFORE SEND (fail closed). A locally-valid edited quote must
    //     never be validated against stale cloud pricing.
    onStep('persist', 'Saving latest scope…');
    var p = await _run('persist', function () { return deps.persist(); });
    if (!p.ok) return p;                       // ← fail closed BEFORE preparation
    if (deps.getJobId) {
      var jid = deps.getJobId();
      if (!jid) return _fail('persist', 'Cloud save did not confirm a job id — refusing to send stale pricing');
      if (p.jobId && p.jobId !== jid) return _fail('persist', 'Job id changed during save — refusing to send');
      attempt.jobId = jid;
    } else if (p.jobId) {
      attempt.jobId = p.jobId;
    }

    // 2 — PREPARE (reserve quote number + document row)
    onStep('prepare', 'Reserving quote number…');
    var prep = await _run('prepare', function () { return deps.prepare({ attempt: attempt }); });
    if (!prep.ok) return prep;
    var prepData = prep.data || {};

    // 3 — GENERATE PDF (uses the reserved quote number)
    onStep('pdf', 'Generating PDF…');
    var pdf = await _run('pdf', function () {
      return deps.generatePdf({ quoteNumber: prepData.quoteNumber, prepData: prepData });
    });
    if (!pdf.ok) return pdf;
    var blob = pdf.blob || pdf.data;
    if (!blob) return _fail('pdf', 'PDF generation failed — no document produced');

    // 4 — UPLOAD PDF
    onStep('upload_pdf', 'Uploading PDF…');
    var up = await _run('upload_pdf', function () { return deps.uploadPdf({ url: prepData.uploadUrl, blob: blob }); });
    if (!up.ok) return up;

    // 5 — OPTIONAL INTERACTIVE HTML (ratified PDF-fallback policy: non-fatal)
    var htmlWarning = null;
    if (prepData.htmlUploadUrl && deps.uploadHtml) {
      onStep('upload_html', 'Uploading web quote…');
      var htmlRes = await _run('upload_html', function () { return deps.uploadHtml({ url: prepData.htmlUploadUrl, prepData: prepData }); });
      if (!htmlRes.ok) htmlWarning = htmlRes.error;   // record; never misreport as delivered
    }

    // 6 — SEND (idempotent). The same attempt key on a retry lets an idempotent
    //     backend collapse it to a single provider call + single release event.
    onStep('send', 'Sending email…');
    attempt.tries++;
    var sent = await _run('send', function () {
      return deps.send({ documentId: prepData.documentId, idempotencyKey: attempt.idempotencyKey, attempt: attempt });
    });
    if (!sent.ok) return sent;

    return {
      ok: true, stage: 'done', attempt: attempt, prepData: prepData,
      sendData: sent.data || {}, htmlWarning: htmlWarning
    };
  }

  // ── Multi-option send ──────────────────────────────────────────────────
  // deps (in addition to single-send analogues):
  //   options                       : [{ id, label, patioName }, ...] (required, ≥1)
  //   persistAll({options})         : persist ALL current option pricing → {ok, jobId} | throws
  //   prepareOption(option, index)  : → {ok, data:{...}}
  //   generateOptionPdf(option, prepData, index) : → {ok, blob} | throws
  //   uploadPdf({url, blob})        : → {ok} | throws
  //   send({documentId, idempotencyKey, attempt, documents}) : → {ok, data} | throws
  //
  // FAIL CLOSED: if any option fails prepare/pdf/upload, this returns before the
  // send call, so `send` (the email adapter) is never invoked — no partial subset
  // is ever emailed.
  async function runMultiSend(deps) {
    deps = deps || {};
    var onStep = deps.onStep || function () {};
    var options = deps.options || [];
    if (!options.length) return _fail('prepare', 'No quote options to send');
    var attempt = deps.attempt || createAttempt({ jobId: deps.getJobId && deps.getJobId(), keygen: deps.keygen });

    // 1 — PERSIST ALL OPTIONS BEFORE ANY PREPARATION (fail closed)
    onStep('persist', 'Saving all options…');
    var p = await _run('persist', function () { return deps.persistAll({ options: options }); });
    if (!p.ok) return p;
    if (deps.getJobId) {
      var jid = deps.getJobId();
      if (!jid) return _fail('persist', 'Cloud save did not confirm a job id — refusing to send stale pricing');
      attempt.jobId = jid;
    } else if (p.jobId) {
      attempt.jobId = p.jobId;
    }

    // 2 — PREPARE + PDF + UPLOAD every option. ANY failure → fail closed.
    var documents = [];
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var label = opt.label || ('option ' + (i + 1));
      onStep('prepare', 'Preparing ' + (i + 1) + ' of ' + options.length + '…');

      var prep = await _run('prepare', (function (opt, i) {
        return function () { return deps.prepareOption(opt, i); };
      })(opt, i));
      if (!prep.ok) return Object.assign(prep, { option: label, prepared: documents.length });
      var prepData = prep.data || {};

      var pdf = await _run('pdf', (function (opt, prepData, i) {
        return function () { return deps.generateOptionPdf(opt, prepData, i); };
      })(opt, prepData, i));
      if (!pdf.ok) return Object.assign(pdf, { option: label, prepared: documents.length });
      var blob = pdf.blob || pdf.data;
      if (!blob) return _fail('pdf', 'PDF generation failed for ' + label, { option: label, prepared: documents.length });

      var up = await _run('upload_pdf', (function (prepData, blob) {
        return function () { return deps.uploadPdf({ url: prepData.uploadUrl, blob: blob }); };
      })(prepData, blob));
      if (!up.ok) return Object.assign(up, { option: label, prepared: documents.length });

      documents.push({ documentId: prepData.documentId, option: label, prepData: prepData });
    }

    // 3 — SINGLE idempotent email covering all prepared options.
    onStep('send', 'Sending email…');
    attempt.tries++;
    var sent = await _run('send', function () {
      return deps.send({
        documentId: documents[0].documentId,
        idempotencyKey: attempt.idempotencyKey,
        attempt: attempt,
        documents: documents
      });
    });
    if (!sent.ok) return sent;

    return { ok: true, stage: 'done', attempt: attempt, documents: documents, sendData: sent.data || {} };
  }

  return {
    generateIdempotencyKey: generateIdempotencyKey,
    createAttempt: createAttempt,
    nextResendAttempt: nextResendAttempt,
    runSingleSend: runSingleSend,
    runMultiSend: runMultiSend
  };
});
