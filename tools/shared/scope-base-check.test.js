#!/usr/bin/env node
/**
 * The patio page re-saves a job that already has a scope (2 Nov 2026).
 *
 * Since 23 Oct the page saves with the signed-in session. The job system then refuses a save onto a job that
 * already has a scope unless the save says which version of the scope it started from (ghl-proxy save_scope:
 * 409 missing_scope_cursor, "reload it before saving"), and refuses one that started from an older version
 * (409 scope_hash_conflict). The page never said, so every re-save of a scoped job was refused.
 *
 * This runs the real tools/shared/cloud.js against a stand-in job system that applies the job system's own
 * rules (secureworks-backend supabase/functions/ghl-proxy/hardening_helpers.ts requiresBaseScopeCursor,
 * stableJsonStringify and scopeJsonHash).
 *
 * Proves:
 *  - a job opened from the job system, with a scope, saves again (and again, as autosave does)
 *  - a job read straight from the jobs table saves again (the page works out the same version mark)
 *  - a job whose scope changed somewhere else since it was opened is still refused, and stays refused
 *  - a job with no scope yet saves as before
 *
 * Run: node tools/shared/scope-base-check.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');

var CLOUD = path.resolve(__dirname, 'cloud.js');
var failed = 0;
var passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); } else { failed++; console.error('  FAIL — ' + msg); }
}

// ── The job system's rules, as secureworks-backend hardening_helpers.ts has them ──
function stableJsonStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJsonStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + stableJsonStringify(value[k]); }).join(',') + '}';
}
function scopeJsonHash(v) { return crypto.createHash('sha256').update(stableJsonStringify(v || {})).digest('hex'); }
function nonEmpty(s) { return !!(s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length > 0); }
function requestedBase(meta) {
  meta = meta || {};
  var v = meta.expectedScopeHash != null ? meta.expectedScopeHash : meta.baseScopeHash != null ? meta.baseScopeHash : meta.base_scope_hash != null ? meta.base_scope_hash : meta.scope_hash;
  return v ? String(v).trim() || null : null;
}

// ── A stand-in job system: load_job and save_scope for a signed-in (user JWT) caller ──
function makeServer(jobs) {
  var log = [];
  function reply(status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function() { return Promise.resolve(JSON.parse(JSON.stringify(body))); } });
  }
  function fetch(url, opts) {
    var u = new URL(url);
    var action = u.searchParams.get('action');
    if (action === 'load_job') {
      var j = jobs[u.searchParams.get('jobId')];
      if (!j) return reply(404, { error: 'Job not found' });
      return reply(200, { job: j, latest_frozen_scope_revision_id: null, frozen_revision_count: 0, current_scope_hash: scopeJsonHash(j.scope_json || {}), current_scope_updated_at: j.updated_at });
    }
    if (action === 'save_scope') {
      var body = JSON.parse(opts.body);
      var t = jobs[body.jobId];
      var expected = requestedBase(body.meta);
      var current = scopeJsonHash(t.scope_json || {});
      if (nonEmpty(t.scope_json) && !expected) { log.push('missing_scope_cursor'); return reply(409, { error: 'This job already has scope data; reload it before saving so the base cursor is known.', code: 'missing_scope_cursor', current_scope_hash: current }); }
      if (expected && expected !== current) { log.push('scope_hash_conflict'); return reply(409, { error: 'scope changed', code: 'scope_hash_conflict', current_scope_hash: current }); }
      t.scope_json = JSON.parse(JSON.stringify(body.scopeJson || {}));
      t.updated_at = new Date(Date.parse(t.updated_at) + 1000).toISOString();
      log.push('saved');
      return reply(200, { job: Object.assign({}, t, { current_scope_hash: scopeJsonHash(t.scope_json), current_scope_updated_at: t.updated_at }) });
    }
    return reply(200, {});
  }
  return { fetch: fetch, log: log };
}

// ── Load the real cloud.js in a page-like context ──
function loadCloud(jobs) {
  var server = makeServer(jobs);
  var listeners = {};
  var sb = {
    auth: {
      getSession: function() { return Promise.resolve({ data: { session: { access_token: 'user-jwt', user: { id: 'u1', email: 'scoper@example.test' } } } }); },
      refreshSession: function() { return Promise.resolve({ data: { session: null } }); },
      onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
    },
    from: function() {
      // The jobs table, read straight (cloud.jobs.loadJob): the row as PostgREST returns it.
      var q = { _id: null, select: function() { return q; }, eq: function(k, v) { q._id = v; return q; },
        single: function() { var j = jobs[q._id]; return Promise.resolve(j ? { data: JSON.parse(JSON.stringify(j)), error: null } : { data: null, error: new Error('not found') }); } };
      return q;
    },
    storage: { from: function() { return {}; } },
  };
  var store = {};
  var win = {
    SUPABASE_URL: 'https://stand-in.supabase.co', SUPABASE_ANON_KEY: 'anon',
    supabase: { createClient: function() { return sb; } },
    location: { search: '', pathname: '/', href: 'https://example.test/' },
    addEventListener: function(t, f) { (listeners[t] = listeners[t] || []).push(f); },
  };
  win.top = win;
  var ctx = {
    window: win, document: { querySelector: function() { return null; }, title: '', visibilityState: 'visible', addEventListener: function() {}, removeEventListener: function() {}, getElementById: function() { return null; }, createElement: function() { return { style: {}, appendChild: function() {}, addEventListener: function() {} }; }, body: { appendChild: function() {} } },
    navigator: { onLine: true },
    localStorage: { getItem: function(k) { return k in store ? store[k] : null; }, setItem: function(k, v) { store[k] = String(v); }, removeItem: function(k) { delete store[k]; } },
    fetch: server.fetch, URL: URL, URLSearchParams: URLSearchParams, console: { log: function() {}, warn: function() {}, error: function() {} },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: function() { return 0; }, clearInterval: function() {},
    Promise: Promise, JSON: JSON, Date: Date, Math: Math, Object: Object, Array: Array, String: String, Error: Error,
    TextEncoder: TextEncoder, Uint8Array: Uint8Array, crypto: crypto.webcrypto,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CLOUD, 'utf8'), ctx, { filename: 'cloud.js' });
  return { cloud: win.SECUREWORKS_CLOUD, server: server };
}

function scoped(id) {
  return { id: id, type: 'patio', status: 'draft', updated_at: '2026-10-20T01:00:00.000Z',
    scope_json: { tool: 'patio', version: '2.0', client: { name: 'TEST' }, patios: [{ options: [{ config: { length: 6000, projection: 4000, roofStyle: 'skillion' } }] }] } };
}
function edited(scope, n) { var s = JSON.parse(JSON.stringify(scope)); s.patios[0].options[0].config.length = 6000 + n; return s; }

async function attempt(fn) { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e.message || String(e) }; } }

(async function() {
  console.log('\n1. A job opened from the job system, with a scope, saves again');
  var a = loadCloud({ j1: scoped('j1') });
  var job = await a.cloud.ghl.loadJob('j1');
  var r1 = await attempt(function() { return a.cloud.ghl.saveScope('j1', edited(job.scope_json, 1), { client_name: 'TEST' }); });
  assert(r1.ok, 'the re-save is accepted' + (r1.ok ? '' : ' (refused: ' + r1.error + ')'));
  var r2 = await attempt(function() { return a.cloud.ghl.saveScope('j1', edited(job.scope_json, 2), { client_name: 'TEST' }); });
  assert(r2.ok, 'the next save after it (autosave) is accepted too' + (r2.ok ? '' : ' (refused: ' + r2.error + ')'));
  assert(a.server.log.join(',') === 'saved,saved', 'the job system saw two saves and no refusal (' + a.server.log.join(',') + ')');

  console.log('\n2. A job read straight from the jobs table saves again');
  var b = loadCloud({ j2: scoped('j2') });
  var row = await b.cloud.jobs.loadJob('j2');
  var r3 = await attempt(function() { return b.cloud.ghl.saveScope('j2', edited(row.scope_json, 3), {}); });
  assert(r3.ok, 'the re-save is accepted' + (r3.ok ? '' : ' (refused: ' + r3.error + ')'));

  console.log('\n3. A scope changed somewhere else since it was opened is never saved over');
  var jobs = { j3: scoped('j3') };
  var c = loadCloud(jobs);
  await c.cloud.ghl.loadJob('j3');
  jobs.j3.scope_json = { tool: 'patio-scoper', version: '2.0', draft: { saved: 'in the Scope Engine' }, revision: { n: 1 } };
  var r4 = await attempt(function() { return c.cloud.ghl.saveScope('j3', edited(scoped('j3').scope_json, 4), {}); });
  assert(!r4.ok, 'the save is refused');
  assert(jobs.j3.scope_json.tool === 'patio-scoper', 'the scope saved elsewhere is untouched');
  var r5 = await attempt(function() { return c.cloud.ghl.saveScope('j3', edited(scoped('j3').scope_json, 5), {}); });
  assert(!r5.ok && jobs.j3.scope_json.tool === 'patio-scoper', 'a second try is refused too, until the job is opened again');

  console.log('\n4. A job with no scope yet saves as before');
  var d = loadCloud({ j4: { id: 'j4', type: 'patio', status: 'draft', updated_at: '2026-10-20T01:00:00.000Z', scope_json: {} } });
  await d.cloud.ghl.loadJob('j4');
  var r6 = await attempt(function() { return d.cloud.ghl.saveScope('j4', edited(scoped('j4').scope_json, 6), {}); });
  assert(r6.ok, 'the first save is accepted');
  var r7 = await attempt(function() { return d.cloud.ghl.saveScope('j4', edited(scoped('j4').scope_json, 7), {}); });
  assert(r7.ok, 'and the save after it' + (r7.ok ? '' : ' (refused: ' + r7.error + ')'));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
