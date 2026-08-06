// ════════════════════════════════════════════════════════════
// SecureWorks — Multi-build (bundle) quote helpers (tool-side)
//
// Pure, DOM-free helpers for the "one project, multiple structures"
// bundle quote (see data/patio-multibuild-quote-design/report.md §4).
// Everything here is deterministic and Node-testable — index.html
// gathers the live data (each structure's specs + inc-GST total + dims)
// and feeds plain objects in; this module returns the combined pricing,
// the staged per-structure payment schedule, the consolidated ("common
// to all") spec view, and the bundle prose. It performs ZERO I/O and
// touches no globals, so it is unit-tested with fakes.
//
// The staged-schedule shape is reverse-engineered EXACTLY from the
// captain's target example (Quote_Will_Gethin_SWP-261126_3-Builds.pdf):
//   50% deposit → 45% split equally across the N structures (one claim
//   per structure as it completes) → 5% final completion. Amounts always
//   reconcile to the combined inc-GST total to the cent (the final claim
//   absorbs the rounding remainder), so screen / PDF / backend agree.
//
// The shared foundation here is reused by the follow-up A/B-compare mode.
// ════════════════════════════════════════════════════════════
(function (root, factory) {
  'use strict';
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.SWMultiQuote = mod;
})(typeof self !== 'undefined' ? self
  : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Default staged-schedule split (matches the target example). Kept as a
  // single constant so Marnin's business rule lives in one place.
  var BUNDLE_SCHEDULE = { depositPct: 50, finalPct: 5 };

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // Money formatter fallback (index.html injects the app's _swMoney so PDF
  // and screen use one formatter; tests use this default).
  function defaultMoney(v) {
    var s = (Number(v) || 0).toFixed(2);
    return '$' + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  function countWord(n) { return (n >= 0 && n < NUM_WORDS.length) ? NUM_WORDS[n] : String(n); }

  // A → B → C … structure letter for a 0-based index.
  function structureLetter(i) { return String.fromCharCode(65 + (i % 26)); }

  // Format m² with up to one decimal, trailing ".0" dropped ("32.8", "25").
  function fmtArea(m2) {
    var n = Number(m2) || 0;
    var s = n.toFixed(1);
    return s.replace(/\.0$/, '');
  }

  // ── Combined pricing + staged per-structure schedule ───────────────────
  // structures : [{ label, dimsStr, roofAreaM2, totalIncGST, totalExGST?, gst? }]
  //   one entry per PHYSICAL STRUCTURE (patio) — options are alternatives and
  //   are resolved to one selected build BEFORE this is called.
  // opts : { sharedCostsIncGST?, sharedGst?, depositPct?, finalPct?, moneyFmt? }
  // Returns { combinedTotalIncGST, combinedGst, combinedExGST, structureCount,
  //           roofAreaTotal, perStructure:[{...}], schedule:[{...}], reconciles }
  function buildBundlePricing(structures, opts) {
    opts = opts || {};
    var money = (typeof opts.moneyFmt === 'function') ? opts.moneyFmt : defaultMoney;
    var list = Array.isArray(structures) ? structures : [];
    var n = list.length;

    var structuresIncGST = 0, structuresGst = 0;
    var perStructure = list.map(function (b, i) {
      var inc = Number(b.totalIncGST) || 0;
      var gst = (b.gst != null) ? (Number(b.gst) || 0)
        : (b.totalExGST != null ? round2(inc - (Number(b.totalExGST) || 0)) : round2(inc - inc / 1.10));
      structuresIncGST += inc;
      structuresGst += gst;
      return {
        index: i,
        letter: structureLetter(i),
        label: b.label || ('Structure ' + structureLetter(i)),
        dimsStr: b.dimsStr || '',
        roofAreaM2: Number(b.roofAreaM2) || 0,
        totalIncGST: round2(inc)
      };
    });

    var sharedIncGST = Number(opts.sharedCostsIncGST) || 0;
    var sharedGst = (opts.sharedGst != null) ? (Number(opts.sharedGst) || 0)
      : round2(sharedIncGST - sharedIncGST / 1.10);

    var combinedTotalIncGST = round2(structuresIncGST + sharedIncGST);
    var combinedGst = round2(structuresGst + sharedGst);
    var combinedExGST = round2(combinedTotalIncGST - combinedGst);
    var roofAreaTotal = list.reduce(function (a, b) { return a + (Number(b.roofAreaM2) || 0); }, 0);

    // Staged schedule: deposit → per-structure completion → final remainder.
    var depositPct = (opts.depositPct != null) ? opts.depositPct : BUNDLE_SCHEDULE.depositPct;
    var finalPct = (opts.finalPct != null) ? opts.finalPct : BUNDLE_SCHEDULE.finalPct;
    var middlePct = 100 - depositPct - finalPct;
    var perPct = n > 0 ? (middlePct / n) : 0;

    var schedule = [];
    var depositAmt = round2(combinedTotalIncGST * depositPct / 100);
    schedule.push({
      kind: 'deposit', pct: depositPct, pctStr: fmtPct(depositPct),
      amt: depositAmt, amtStr: money(depositAmt),
      stage: 'Deposit', desc: 'Confirms your booking and build dates.'
    });

    var perAmt = n > 0 ? round2(combinedTotalIncGST * (middlePct / 100) / n) : 0;
    var structSum = 0;
    perStructure.forEach(function (s) {
      structSum = round2(structSum + perAmt);
      schedule.push({
        kind: 'structure', pct: perPct, pctStr: fmtPct(perPct),
        amt: perAmt, amtStr: money(perAmt),
        stage: 'Structure ' + s.letter + ' complete',
        desc: s.dimsStr || (s.label || ''),
        structureIndex: s.index
      });
    });

    // Final claim absorbs the exact rounding remainder so the schedule sums
    // to the combined total to the cent.
    var finalAmt = round2(combinedTotalIncGST - depositAmt - structSum);
    schedule.push({
      kind: 'final', pct: finalPct, pctStr: fmtPct(finalPct),
      amt: finalAmt, amtStr: money(finalAmt),
      stage: 'Final completion', desc: 'After final walkthrough of all works.'
    });

    var scheduleSum = schedule.reduce(function (a, s) { return round2(a + s.amt); }, 0);

    return {
      combinedTotalIncGST: combinedTotalIncGST,
      combinedTotalStr: money(combinedTotalIncGST),
      combinedGst: combinedGst,
      combinedGstStr: money(combinedGst),
      combinedExGST: combinedExGST,
      structureCount: n,
      roofAreaTotal: roofAreaTotal,
      roofAreaTotalStr: fmtArea(roofAreaTotal),
      perStructure: perStructure,
      schedule: schedule,
      scheduleSum: scheduleSum,
      // Load-bearing invariant (P-RB-06): schedule reconciles to the total.
      reconciles: scheduleSum === combinedTotalIncGST
    };
  }

  function fmtPct(p) {
    var n = Number(p) || 0;
    // integer → "50"; fractional → one decimal ("22.5"), trailing .0 dropped.
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(1).replace(/\.0$/, '');
  }

  // ── Spec consolidation ("common to all" + per-build deltas) ────────────
  // builds : [{ label, specs:[[key,value], ...] }]  (specs = gatherQuoteData().specs)
  // Dimensions/Shape rows are always per-build (rendered as the build header),
  // so they are excluded from the shared table.
  // Returns { common:[[k,v]], perBuild:[{label, deltas:[[k,v]]}], allCommon }
  function consolidateSpecs(builds) {
    var list = Array.isArray(builds) ? builds : [];
    var EXCLUDE = { 'Dimensions': 1, 'Shape': 1 };

    // Stable union of spec keys (first build's order, then any new keys).
    var order = [];
    var seenKey = {};
    list.forEach(function (b) {
      (b.specs || []).forEach(function (row) {
        var k = row[0];
        if (EXCLUDE[k]) return;
        // Zone rows in multi-zone specs carry dynamic labels — treat any key
        // not shared by every build as a per-build delta below; but skip
        // zone-style keys (e.g. "Zone A") from the shared table entirely.
        if (!seenKey[k]) { seenKey[k] = 1; order.push(k); }
      });
    });

    function valueFor(b, key) {
      var found = (b.specs || []).find(function (r) { return r[0] === key; });
      return found ? found[1] : null;
    }

    var common = [];
    var deltaKeys = [];
    order.forEach(function (key) {
      var vals = list.map(function (b) { return valueFor(b, key); });
      var presentEverywhere = vals.every(function (v) { return v != null; });
      var allSame = presentEverywhere && vals.every(function (v) { return v === vals[0]; });
      if (allSame) common.push([key, vals[0]]);
      else deltaKeys.push(key);
    });

    var perBuild = list.map(function (b) {
      var deltas = [];
      deltaKeys.forEach(function (key) {
        var v = valueFor(b, key);
        if (v != null) deltas.push([key, v]);
      });
      return { label: b.label || '', deltas: deltas };
    });

    return { common: common, perBuild: perBuild, allCommon: deltaKeys.length === 0 };
  }

  // Look up a spec value by key from a [[k,v]] array (null if absent).
  function specValue(specs, key) {
    var found = (specs || []).find(function (r) { return r[0] === key; });
    return found ? found[1] : null;
  }

  // Page-2 per-build design subset: STYLE / ROOFING / FRAME / POSTS.
  // Mirrors the target example (a curated 4-row block beside each render).
  function pickDesignSpecs(specs) {
    var style = specValue(specs, 'Style');
    var roofing = specValue(specs, 'Roofing');
    var frame = specValue(specs, 'Frame Colour');
    var posts = specValue(specs, 'Posts');
    // Posts value is "90×90×2 SHS × 6" — the example shows only the profile.
    if (posts) posts = String(posts).replace(/\s*[×x]\s*\d+\s*$/, '');
    var out = [];
    if (style) out.push(['Style', style]);
    if (roofing) out.push(['Roofing', roofing]);
    if (frame) out.push(['Frame', frame]);
    if (posts) out.push(['Posts', posts]);
    return out;
  }

  // ── Bundle prose ───────────────────────────────────────────────────────
  // Page-2 intro line, generated from the consolidated common specs.
  function bundleDesignLede(consolidated, n) {
    var cw = countWord(n);
    var common = (consolidated && consolidated.common) || [];
    var style = specValue(common, 'Style');            // e.g. "Skillion roof patio"
    var attach = specValue(common, 'Attachment');       // e.g. "Freestanding"
    var roofing = specValue(common, 'Roofing');          // e.g. "ProDek, Monument"
    var frame = specValue(common, 'Frame Colour');      // e.g. "Monument, powdercoated steel"

    if (!consolidated || !consolidated.allCommon || !style) {
      return cw.charAt(0).toUpperCase() + cw.slice(1)
        + ' separate structures, engineered and installed as one project — each specified below, '
        + 'designed to sit together as one consistent set.';
    }
    var styleShort = String(style).replace(/\s*patio$/i, '').toLowerCase();  // "skillion roof"
    var attachLower = attach ? String(attach).toLowerCase() : '';
    var roofingPhrase = roofing ? String(roofing).replace(/^([^,]+)(,|$)/, '$1 sheeting$2') : '';
    var frameLower = frame ? String(frame).toLowerCase().replace(/^([^,]+),\s*(.+)$/, '$2 $1') : '';
    var parts = cw.charAt(0).toUpperCase() + cw.slice(1) + ' separate structures, engineered and installed as one project. Each is a ';
    parts += (attachLower ? attachLower + ' ' : '') + styleShort;
    if (roofingPhrase) parts += ' in ' + roofingPhrase;
    if (frameLower) parts += ', framed in ' + frameLower;
    parts += ' — designed to sit together as one consistent set.';
    return parts;
  }

  // Page-3 scope-of-works lead line.
  // opts : { connectionPhrase?, hasPlans? }
  function bundleScopeLead(perStructure, opts) {
    opts = opts || {};
    var list = perStructure || [];
    var n = list.length;
    var cw = countWord(n);
    var dims = list.map(function (s) { return s.dimsStr; }).filter(Boolean);
    var dimsJoined = joinAnd(dims);
    var conn = opts.connectionPhrase ? (', ' + opts.connectionPhrase) : '';
    var plans = opts.hasPlans === false ? 'engineered plans' : 'engineered, council-ready plans';
    return 'All ' + cw + ' structures' + (dimsJoined ? ' — ' + dimsJoined : '')
      + conn + ' — built by our licensed crew to ' + plans + '.';
  }

  function joinAnd(arr) {
    arr = (arr || []).filter(function (x) { return x != null && x !== ''; });
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  }

  // Light, safe pluralisation of the representative build's scope groups for
  // the unified bundle scope. Each substitution is a no-op if it does not
  // match, so an unexpected scope phrasing is never mangled.
  function pluralizeScopeGroups(groups, n) {
    var cw = countWord(n);
    function rw(text) {
      var t = String(text);
      t = t.replace(/\bthe [\d.]+m x [\d.]+m build area\b/gi, 'all ' + cw + ' build areas');
      t = t.replace(/\bClear and prepare the build area\b/gi, 'Clear and prepare all ' + cw + ' build areas');
      t = t.replace(/to the engineered plan,/gi, 'to the engineered plan for each structure,');
      t = t.replace(/to engineered layout\b/gi, 'to the engineered layout for each structure');
      t = t.replace(/to engineered specification\b/gi, 'to engineered specification for each structure');
      t = t.replace(/with client to confirm all work is complete and satisfactory/gi,
        'with client across all ' + cw + ' structures to confirm all work is complete and satisfactory');
      return t;
    }
    return (groups || []).map(function (g) {
      return { stage: g.stage, items: (g.items || []).map(rw) };
    });
  }

  // ── Multi-build readiness gate (M5) ────────────────────────────────────
  // builds : [{ label, scoped, hasRender, totalIncGST, hasBlockingPricingError }]
  // Returns { ok, blockers:[...] }. The combined quote only unlocks when every
  // structure is scoped + rendered + priced and the combined total is present.
  function assessBundleReadiness(builds, combinedTotalIncGST) {
    var list = Array.isArray(builds) ? builds : [];
    var blockers = [];
    if (list.length < 2) blockers.push('A combined quote needs at least 2 structures.');
    list.forEach(function (b, i) {
      var name = b.label || ('Structure ' + structureLetter(i));
      if (!b.scoped) blockers.push(name + ' has not been scoped yet.');
      if (!b.hasRender) blockers.push(name + ' has no 3D render captured.');
      if (!(Number(b.totalIncGST) > 0)) blockers.push(name + ' has no price.');
      if (b.hasBlockingPricingError) blockers.push(name + ' has a pricing error that must be fixed.');
    });
    if (!(Number(combinedTotalIncGST) > 0)) blockers.push('The combined project total is missing.');
    return { ok: blockers.length === 0, blockers: blockers };
  }

  return {
    BUNDLE_SCHEDULE: BUNDLE_SCHEDULE,
    round2: round2,
    fmtArea: fmtArea,
    fmtPct: fmtPct,
    countWord: countWord,
    structureLetter: structureLetter,
    joinAnd: joinAnd,
    defaultMoney: defaultMoney,
    buildBundlePricing: buildBundlePricing,
    consolidateSpecs: consolidateSpecs,
    specValue: specValue,
    pickDesignSpecs: pickDesignSpecs,
    bundleDesignLede: bundleDesignLede,
    bundleScopeLead: bundleScopeLead,
    pluralizeScopeGroups: pluralizeScopeGroups,
    assessBundleReadiness: assessBundleReadiness
  };
});
