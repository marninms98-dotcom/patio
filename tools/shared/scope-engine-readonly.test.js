#!/usr/bin/env node
/**
 * A job the Scope Engine saved last opens here read-only (2 Nov 2026).
 *
 * Both tools are live. When the Scope Engine saved a patio job last, the job holds the Scope Engine's record
 * (scope_json.tool === 'patio-scoper'), which this page cannot read. Loading it into this page's form and saving
 * would put this page's form over the Scope Engine's work. So this page opens such a job read-only (no save,
 * autosave, sign-off or send) with a plain line saying it was last saved in the new tool, and a link to open it
 * there. A job this page saved opens as before.
 *
 * Runs the real loadPatioState and _shouldAutoSave from tools/shared/integration.js in a stand-in page.
 *
 * Run: node tools/shared/scope-engine-readonly.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = fs.readFileSync(path.resolve(__dirname, 'integration.js'), 'utf8');
var failed = 0;
var passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); } else { failed++; console.error('  FAIL — ' + msg); }
}

// A function's whole text from integration.js, by its opening line.
function fnText(signature) {
  var start = SRC.indexOf(signature);
  if (start < 0) return null;
  var brace = SRC.indexOf('{', start), depth = 0;
  for (var i = brace; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  return null;
}

function page(jobIdInUrl) {
  var classes = {};
  var created = [];
  function el(tag) {
    var e = { tagName: tag.toUpperCase(), children: [], style: {}, attrs: {}, textContent: '', href: '', className: '',
      setAttribute: function(k, v) { this.attrs[k] = String(v); if (k === 'href') this.href = String(v); },
      appendChild: function(c) { this.children.push(c); return c; } };
    created.push(e);
    return e;
  }
  var body = el('body');
  body.insertBefore = function(c) { this.children.unshift(c); return c; };
  var calls = { loadJobData: 0, stopAutoSave: 0 };
  var win = {
    location: { search: jobIdInUrl ? '?jobId=' + jobIdInUrl : '', href: 'https://marninms98-dotcom.github.io/patio/' },
    loadJobData: function() { calls.loadJobData++; },
  };
  var doc = {
    documentElement: { classList: { add: function(c) { classes[c] = true; }, contains: function(c) { return !!classes[c]; } } },
    body: body,
    head: el('head'),
    createElement: el,
    getElementById: function(id) { return id === 'loadJobTextarea' ? { value: '' } : null; },
  };
  var ctx = {
    window: win, document: doc, console: { log: function() {}, warn: function() {}, error: function() {} },
    URLSearchParams: URLSearchParams, JSON: JSON, setTimeout: function(f) { f(); return 0; }, encodeURIComponent: encodeURIComponent,
    cloud: { stopAutoSave: function() { calls.stopAutoSave++; } },
    _isReadonly: false, _jobStatus: 'draft', _jobId: null,
  };
  vm.createContext(ctx);
  var parts = ['function loadPatioState(scopeJson) {', 'function _shouldAutoSave() {', 'function _openScopeEngineRecordReadonly('];
  parts.forEach(function(sig) { var t = fnText(sig); if (t) vm.runInContext(t, ctx); });
  return { ctx: ctx, calls: calls, classes: classes, created: created, body: body };
}

var RECORD = { tool: 'patio-scoper', version: '2.0', draft: { patio: 'saved in the Scope Engine' }, lines: [], revision: { n: 3 }, earlier: [] };
var OLD = { tool: 'patio', version: '2.0', client: { name: 'TEST' }, config: { length: 6000, projection: 4000, roofStyle: 'skillion' } };
var JOB = '2fc6d267-cf9a-4a5b-b42b-ccc2fb87d006';

console.log('\n1. A job the Scope Engine saved last opens read-only');
var a = page(JOB);
var loaded = a.ctx.loadPatioState(RECORD);
a.ctx._jobId = JOB;
assert(loaded === true, 'the job opens (the page carries on with it)');
assert(a.calls.loadJobData === 0, "the Scope Engine's record is not loaded into this page's form");
assert(a.ctx._isReadonly === true, 'the page is read-only for this job (save, sign-off and send are refused)');
assert(typeof a.ctx._shouldAutoSave === 'function' && a.ctx._shouldAutoSave() === false, 'autosave stays off');
assert(a.calls.stopAutoSave >= 1, 'any autosave already running is stopped');
assert(a.classes['readonly-mode'] === true, 'the save buttons are hidden (readonly-mode)');
var words = a.created.map(function(e) { return e.textContent; }).join(' ');
assert(/last saved in the new Scope Engine/i.test(words), 'a plain line says it was last saved in the new tool (' + JSON.stringify(words.slice(0, 120)) + ')');
var link = a.created.filter(function(e) { return e.tagName === 'A'; })[0];
assert(!!link && link.href === 'https://marninms98-dotcom.github.io/patio/scope-engine/?jobId=' + JOB, 'it links to the job in the new tool (' + (link && link.href) + ')');

console.log('\n2. A job this page saved opens as before');
var b = page(JOB);
var loaded2 = b.ctx.loadPatioState(OLD);
assert(loaded2 === true && b.calls.loadJobData === 1, "this page's own scope loads into its form");
assert(b.ctx._isReadonly === false && b.ctx._shouldAutoSave() === true, 'and saves and autosaves as before');
assert(!b.classes['readonly-mode'], 'no read-only line');

console.log('\n3. The read-only gates the page already has');
assert(/if \(_isReadonly\) \{\s*console\.warn\('\[Integration\] Save blocked/.test(SRC), 'a save is refused while read-only');
assert(/if \(_isReadonly\) return \{ ok: false, reason: 'readonly' \}/.test(SRC), 'a send is refused while read-only');
assert(/Sign-off blocked — readonly mode/.test(SRC), 'a sign-off is refused while read-only');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
