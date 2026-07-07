#!/usr/bin/env node
/**
 * WAVE B TOTALS PARITY HARNESS — patio tool money path
 * ----------------------------------------------------
 * Drives the REAL app in headless Chrome (never re-implements pricing logic)
 * and, for six fixtures, captures BOTH the on-screen total (pricingState from
 * updatePricing) AND the quote total that is actually sent (buildPricingJson).
 *
 * It runs the SAME fixtures against two builds:
 *   BASELINE  = pristine origin/main @dfbcf67   (env PATIO_BASELINE)
 *   BUILT     = Wave B branch                    (env PATIO_BUILT)
 *
 * Required results (contract §6):
 *   1. In BUILT, screen total == quote total for every fixture.
 *   2. Every baseline→built delta is attributable to a Wave B unit.
 *   3. F3 (reverse skillion) captured with REVERSE_SKILLION_UPLIFT_APPLIES
 *      both true and false (the D3 gate pack).
 *
 * Run:
 *   NODE_PATH=<scratch>/node_modules node parity/wave_b_totals_parity.mjs
 * Env:
 *   PATIO_BASELINE=/abs/path/patio-review/index.html
 *   PATIO_BUILT=/abs/path/patio-build/index.html
 *   ONLY=F1        (optional — run a single fixture)
 */
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
// Puppeteer is installed in a scratch dir (kept out of the repo). Resolve it
// from PUPPETEER_DIR (a node_modules parent) so this harness stays portable.
const _req = createRequire(import.meta.url);
const _pptrDir = process.env.PUPPETEER_DIR || '';
let puppeteer;
try {
  puppeteer = (await import(_pptrDir ? _req.resolve('puppeteer', { paths: [_pptrDir] }) : 'puppeteer')).default;
} catch (e) {
  console.error('Cannot load puppeteer. Set PUPPETEER_DIR to a folder whose node_modules has puppeteer.\n', String(e));
  process.exit(2);
}

const BASELINE = process.env.PATIO_BASELINE;
const BUILT = process.env.PATIO_BUILT;
const ONLY = process.env.ONLY || '';
if (!BASELINE || !BUILT) { console.error('Set PATIO_BASELINE and PATIO_BUILT'); process.exit(2); }

// ── Fixture library ────────────────────────────────────────────────────────
// Each fixture is a browser-side function body that mutates inputs/globals and
// returns nothing; the harness then calls rebuildAll() and reads the totals.
const FIXTURES = {
  F1: {
    name: '6×3 flat skillion',
    apply: function () {
      setStyle('skillion'); setV('inLength', 6); setV('inWidth', 3); setV('inPostHeight', 2.4); setV('inPitch', 10);
      setSelect('inRoofing', 'trimdek'); setSelect('inConnection', 'fascia');
    }
  },
  F2: {
    name: 'gable, web-style trusses',
    apply: function () {
      setStyle('gable'); setV('inLength', 6); setV('inWidth', 4); setV('inPostHeight', 2.4); setV('inPitch', 15);
      setSelect('inRoofing', 'trimdek'); setSelect('inConnection', 'fascia');
      setSelect('inTrussBase', 'web');
    }
  },
  F3: {
    name: 'reverse skillion',
    apply: function () {
      setStyle('reverse_skillion'); setV('inLength', 6); setV('inWidth', 3.5); setV('inPostHeight', 2.7); setV('inPitch', 5);
      setSelect('inRoofing', 'solarspan100'); setSelect('inConnection', 'riser');
    }
  },
  F4: {
    name: 'multi-zone L',
    apply: function () {
      setStyle('skillion'); setV('inLength', 6); setV('inWidth', 3); setV('inPostHeight', 2.4); setV('inPitch', 10);
      setSelect('inRoofing', 'trimdek'); setSelect('inConnection', 'fascia');
      if (typeof setPatioShape === 'function') { try { setPatioShape('lshape'); } catch (e) {} }
    }
  },
  F5: {
    name: 'skillion + drawn barge profile + one unmatched profile',
    apply: function () {
      setStyle('skillion'); setV('inLength', 6); setV('inWidth', 3); setV('inPostHeight', 2.4); setV('inPitch', 10);
      setSelect('inRoofing', 'trimdek'); setSelect('inConnection', 'fascia');
      if (typeof flashingProfiles !== 'undefined') {
        flashingProfiles.length = 0;
        flashingProfiles.push({ id: 'fx_barge', name: 'Barge Cap', girth: 300, length: 6000, qty: 2, points: [] });
        flashingProfiles.push({ id: 'fx_apron', name: 'Custom Apron', girth: 250, length: 3200, qty: 1, points: [] });
      }
    }
  },
  F6: {
    name: 'job with a $0-rate line (spandek roofing = $0)',
    apply: function () {
      setStyle('skillion'); setV('inLength', 6); setV('inWidth', 3); setV('inPostHeight', 2.4); setV('inPitch', 10);
      setSelect('inRoofing', 'spandek'); setSelect('inConnection', 'fascia');
    }
  },
  F7: {
    name: 'CUSTOM job type (auto categories zeroed, custom lines drive total)',
    apply: function () {
      setStyle('skillion'); setV('inLength', 6); setV('inWidth', 3); setV('inPostHeight', 2.4); setV('inPitch', 10);
      setSelect('inRoofing', 'trimdek'); setSelect('inConnection', 'fascia');
      // Populate custom lines then flip job type to custom.
      if (typeof customLines !== 'undefined') {
        customLines.length = 0;
        customLines.push({ desc: 'Bespoke pergola rework', qty: 2, unitCost: 800, unitSell: 2100 });
        customLines.push({ desc: 'Feature beam', qty: 1, unitCost: 450, unitSell: 1200 });
      }
      var jt = document.getElementById('inJobType'); if (jt) jt.value = 'custom';
      var cc = document.getElementById('inCustomCost'); if (cc) cc.value = '2050';
      var cs = document.getElementById('inCustomSell'); if (cs) cs.value = '5400';
    }
  },
  F8: {
    name: 'QUOTE_ONLY job type (manual cost/price only)',
    apply: function () {
      setStyle('skillion'); setV('inLength', 6); setV('inWidth', 3); setV('inPostHeight', 2.4); setV('inPitch', 10);
      setSelect('inRoofing', 'trimdek'); setSelect('inConnection', 'fascia');
      var jt = document.getElementById('inJobType'); if (jt) jt.value = 'quote_only';
      var qc = document.getElementById('inQuoteOnlyCost'); if (qc) qc.value = '3000';
      var qs = document.getElementById('inQuoteOnlySell'); if (qs) qs.value = '6000';
      var qd = document.getElementById('inQuoteOnlyDesc'); if (qd) qd.value = 'Supply only, install by others';
    }
  }
};

// Browser-side helpers injected before each fixture apply().
const HELPERS = `
  window.__setV = function(id, v){ var el=document.getElementById(id); if(el){ el.value=String(v); if(typeof el.onchange==='function'){} } };
  window.setV = window.__setV;
  window.setSelect = function(id, v){ var el=document.getElementById(id); if(el){ el.value=String(v); } };
  window.setStyle = function(v){
    // roof style lives on inRoofStyle (select or hidden); set + fire updateUI if present
    var el=document.getElementById('inRoofStyle'); if(el){ el.value=v; }
    try { if(typeof updateUI==='function') updateUI(); } catch(e){}
  };
`;

async function readTotals(page) {
  return await page.evaluate(() => {
    function num(x){ return (typeof x === 'number' && isFinite(x)) ? x : null; }
    var ps = (typeof pricingState === 'object' && pricingState) ? pricingState : {};
    var q = {};
    try { q = (typeof buildPricingJson === 'function') ? buildPricingJson() : (window.buildPricingJson ? window.buildPricingJson() : {}); } catch(e){ q = { __err: String(e) }; }
    // jobRows summary for delta attribution
    var rows = [];
    try {
      (jobRows||[]).forEach(function(r){
        var tc; if(r.unit==='nested') tc=r.unitCost; else if(r.unit==='LM') tc=r.qty*r.length*r.unitCost; else tc=r.qty*r.unitCost;
        var ts; if(r.unit==='nested') ts=r.unitSell; else if(r.unit==='LM') ts=r.qty*r.length*r.unitSell; else ts=r.qty*r.unitSell;
        rows.push({ desc:r.desc, qty:r.qty, unit:r.unit, length:r.length, unitCost:r.unitCost, unitSell:r.unitSell, totalCost:+(tc||0).toFixed(2), totalSell:+(ts||0).toFixed(2) });
      });
    } catch(e){}
    return {
      screen: {
        matCost: num(ps.matCost), matSell: num(ps.matSell),
        totalSell: num(ps.totalSell), totalIncGST: num(ps.totalIncGST),
        trueCost: num(ps.trueCost), grossMargin: num(ps.grossMargin),
        commissionAmt: num(ps.commissionAmt), margin: num(ps.margin), marginPct: num(ps.marginPct)
      },
      quote: {
        totalExGST: num(q.totalExGST), totalIncGST: num(q.totalIncGST),
        totalCostEstimate: num(q.totalCostEstimate), materialCostEstimate: num(q.materialCostEstimate),
        commissionCostEstimate: num(q.commissionCostEstimate), margin_pct: num(q.margin_pct),
        nLineItems: (q.line_items||[]).length,
        lineItemsSell: +((q.line_items||[]).reduce(function(a,li){return a+(li.total_sell||0);},0)).toFixed(2),
        err: q.__err || null
      },
      calc: (typeof calc==='object' && calc) ? { isReverse: !!calc.isReverse, isGable: !!calc.isGable, isMultiZone: !!calc.isMultiZone, rafter: calc.rafter, L: calc.L, W: calc.W, roofing: calc.roofing } : {},
      rows: rows
    };
  });
}

async function runFixture(page, fx, uplift) {
  await page.evaluate(HELPERS + '\n(' + fx.apply.toString() + ')();');
  if (uplift !== undefined) {
    await page.evaluate((u) => { if (typeof REVERSE_SKILLION_UPLIFT_APPLIES !== 'undefined') { window.REVERSE_SKILLION_UPLIFT_APPLIES = u; } }, uplift);
  }
  await page.evaluate(() => { if (typeof rebuildAll === 'function') rebuildAll(); });
  return await readTotals(page);
}

// Boot a FRESH page for every fixture so no shape/roof-style/flashing state
// leaks between fixtures (fixtures are otherwise not isolated — the app keeps
// mutable globals like patioShape / flashingProfiles across recalcs).
async function bootFreshPage(browser, file) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page._swErrors = errors;
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => typeof rebuildAll === 'function' && typeof window.buildPricingJson === 'function', { timeout: 90000 });
  await new Promise(r => setTimeout(r, 350));
  return page;
}

async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
  });
  try { return await fn(browser); }
  finally { await browser.close(); }
}

function fmt(n){ return n==null ? 'n/a' : ('$' + Number(n).toFixed(2)); }

async function main() {
  const keys = ONLY ? [ONLY] : Object.keys(FIXTURES);
  const report = {};
  for (const side of ['baseline', 'built']) {
    const file = side === 'baseline' ? BASELINE : BUILT;
    report[side] = await withBrowser(async (browser) => {
      const res = {};
      for (const k of keys) {
        const fx = FIXTURES[k];
        res[k] = { def: fx.name };
        // Fresh page per fixture (isolation).
        let page = await bootFreshPage(browser, file);
        res[k].main = await runFixture(page, fx, undefined);
        res[k].main.__pageErrors = (page._swErrors || []).slice(0, 6);
        await page.close();
        if (k === 'F3') {
          page = await bootFreshPage(browser, file);
          res[k].upliftOn = await runFixture(page, fx, true);
          await page.close();
          page = await bootFreshPage(browser, file);
          res[k].upliftOff = await runFixture(page, fx, false);
          await page.close();
        }
      }
      return res;
    });
  }

  // ── Print ──
  console.log('\n================ WAVE B TOTALS PARITY ================\n');
  for (const k of keys) {
    const b = report.baseline[k].main, u = report.built[k].main;
    console.log(`── ${k}: ${FIXTURES[k].name} ──`);
    console.log(`  calc: isReverse=${u.calc.isReverse} isGable=${u.calc.isGable} isMultiZone=${u.calc.isMultiZone} rafter=${u.calc.rafter} L=${u.calc.L} W=${u.calc.W} roofing=${u.calc.roofing}`);
    console.log(`  BASELINE screen.totalIncGST=${fmt(b.screen.totalIncGST)}  quote.totalIncGST=${fmt(b.quote.totalIncGST)}  Δ(s-q)=${fmt((b.screen.totalIncGST||0)-(b.quote.totalIncGST||0))}`);
    console.log(`  BUILT    screen.totalIncGST=${fmt(u.screen.totalIncGST)}  quote.totalIncGST=${fmt(u.quote.totalIncGST)}  Δ(s-q)=${fmt((u.screen.totalIncGST||0)-(u.quote.totalIncGST||0))}`);
    const eq = Math.abs((u.screen.totalIncGST||0)-(u.quote.totalIncGST||0)) < 0.01;
    console.log(`  BUILT screen==quote? ${eq ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  baseline→built screen Δ=${fmt((u.screen.totalIncGST||0)-(b.screen.totalIncGST||0))}   quote Δ=${fmt((u.quote.totalIncGST||0)-(b.quote.totalIncGST||0))}`);
    console.log(`  quote line_items: baseline n=${b.quote.nLineItems} Σsell=${fmt(b.quote.lineItemsSell)} | built n=${u.quote.nLineItems} Σsell=${fmt(u.quote.lineItemsSell)}`);
    if (b.quote.err || u.quote.err) console.log(`  quote err: baseline=${b.quote.err} built=${u.quote.err}`);
    if (k === 'F3') {
      const on = report.built[k].upliftOn, off = report.built[k].upliftOff;
      console.log(`  D3 GATE PACK (built):`);
      console.log(`    uplift ON : screen=${fmt(on.screen.totalIncGST)} quote=${fmt(on.quote.totalIncGST)} (eq ${Math.abs((on.screen.totalIncGST||0)-(on.quote.totalIncGST||0))<0.01})`);
      console.log(`    uplift OFF: screen=${fmt(off.screen.totalIncGST)} quote=${fmt(off.quote.totalIncGST)} (eq ${Math.abs((off.screen.totalIncGST||0)-(off.quote.totalIncGST||0))<0.01})`);
      console.log(`    uplift Δ  : ${fmt((on.quote.totalIncGST||0)-(off.quote.totalIncGST||0))}`);
    }
    console.log('');
  }
  if (report.baseline[keys[0]].main.__pageErrors?.length || report.built[keys[0]].main.__pageErrors?.length) {
    console.log('page errors (baseline):', report.baseline[keys[0]].main.__pageErrors);
    console.log('page errors (built):', report.built[keys[0]].main.__pageErrors);
  }
  // Emit machine-readable dump for the evidence writer
  const fs = await import('fs');
  const outPath = process.env.PARITY_JSON || '/tmp/wave_b_parity.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('Full JSON →', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
