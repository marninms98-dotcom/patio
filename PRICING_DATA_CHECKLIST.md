# Patio Scoping Tool — Pricing Data Checklist

**Purpose:** Every row below is a pricing input the code currently relies on. The owner (Marnin) needs to confirm an approved business value for each row before the pricing safety guards introduced in Phase 1 will pass. Prices are **not invented or estimated** in this document — the "Approved value" column is blank by design.

**Legend — Required for quoting:**
- **Always** — the value affects every quote.
- **Conditional** — only required when the matching material/feature is used in the job.
- **Policy** — a business-policy number (markup, GST, commission, margin target). Owner-confirmed.
- **Optional** — only used when the scoper picks the matching extra.

**Legend — Risk if missing or wrong:**
- **Critical** — quote leaves the tool at $0 or radically wrong; direct revenue loss.
- **High** — silently undercharges/overcharges; impact compounds with job size.
- **Medium** — affects a single line item; usually visible if scoper checks.
- **Low** — display or formatting only; no $ impact in quote.

All file paths are relative to `/Users/nithinsilas/patio`.

---

## 1. Steel rates ($/LM)

Two tables hold the same data: `DEFAULT_RATES` (UI / rate panel) and `STEEL_RATES` (consumed by `buildJobRows` for nested + per-piece stock costing). **Both copies must be updated together** or the materials table and the cost calc will disagree.

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `50×25×1.6 RHS` | 0.00 | index.html:22556 (DEFAULT_RATES); index.html:22645 (STEEL_RATES) | `buildJobRows` 23530; `matchRate` 23415 | Conditional (used when size selected) | Critical — silently $0 | | per LM |
| `65×35×2 RHS` | 0.00 | index.html:22557; 22646 | `buildJobRows`; `matchRate` 23414 | Conditional | Critical — silently $0 | | per LM |
| `75×35×2 RHS` | 0.00 | index.html:22558; 22647 | `buildJobRows`; `matchRate` | Conditional | Critical — silently $0 | | per LM |
| `76×38×1.6 RHS` | 15.50 | index.html:22559; 22648 | Standard rafter/truss/batten/strut size | Conditional (very common) | High — wrong margin on most jobs | | per LM |
| `75×50×2 RHS` | 26.00 | index.html:22560; 22649 | `buildJobRows` | Conditional | High | | per LM |
| `100×50×2 RHS` | 30.00 | index.html:22561; 22650 | Standard beam | Conditional (very common) | High | | per LM |
| `125×50×2 RHS` | 0.00 | index.html:22562; 22659 | `buildJobRows` | Conditional | Critical — silently $0 | | per LM |
| `150×50×2 RHS` | 39.05 | index.html:22563; 22651 | `buildJobRows` | Conditional | High | | per LM |
| `150×50×3 RHS` | 0.00 | index.html:22564; 22652 | `buildJobRows` | Conditional | Critical — silently $0 | | per LM |
| `65×65×2 SHS` | 0.00 | index.html:22550; 22654 | `buildJobRows`; `matchRate` 23110 | Conditional | Critical — silently $0 | | per LM |
| `75×75×2 SHS` | 0.00 | index.html:22551; 22655 | `buildJobRows`; `matchRate` 23111 | Conditional | Critical — silently $0 | | per LM |
| `90×90×2 SHS` | 35.50 | index.html:22552; 22653 | Standard post | Conditional (common) | High | | per LM |
| `100×100×2 SHS` | 0.00 | index.html:22553; 22656 | `buildJobRows`; `matchRate` 23112 | Conditional | Critical — silently $0 | | per LM |
| `125×125×3 SHS` | 0.00 | index.html:22554; 22657 | `buildJobRows`; `matchRate` 23113 | Conditional | Critical — silently $0 | | per LM |
| `150×150×3 SHS` | 0.00 | index.html:22555; 22658 | `buildJobRows`; `matchRate` 23114 | Conditional | Critical — silently $0 | | per LM |
| `C150 Purlin` | 0.00 | index.html:22565 | `matchRate` 23117 | Conditional | Critical — silently $0 | | per LM |
| `C200 Purlin` | 0.00 | index.html:22566 | `matchRate` 23116 | Conditional | Critical — silently $0 | | per LM |

---

## 2. Roofing rates ($/LM)

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `Solarspan 75mm` | 110.00 | index.html:22568 | `matchRate` 23127 | Conditional | High | | per LM |
| `Solarspan 100mm` | 110.00 | index.html:22569 | `matchRate` 23127 (any solarspan) | Conditional | High | | per LM |
| `Stratco CGI 75mm` | 110.00 | index.html:22570 | `matchRate` (roofing match) | Conditional | High | | per LM |
| `Stratco CGI 100mm` | 110.00 | index.html:22571 | `matchRate` | Conditional | High | | per LM |
| `Spanplus 330` | 12.04 | index.html:22572 | `matchRate` | Conditional | High | | per LM |
| `Trimdek Colorbond` | 22.00 | index.html:22573 | `matchRate` 23132 | Conditional | High | | per LM |
| `Corrugated Colorbond` | 22.00 | index.html:22574 | `matchRate` 23134 | Conditional | High | | per LM |
| `Spandek Colorbond` | 0.00 | index.html:22575 | `matchRate` 23133 | Conditional | Critical — silently $0 | | per LM |
| `Ampelite Solasafe 5-Rib` | 0.00 | index.html:22576 | `matchRate` 23130–23131 | Conditional | Critical — silently $0 | | per LM |
| `Ampelite Solasafe Corrugated` | 0.00 | index.html:22577 | `matchRate` 23129 | Conditional | Critical — silently $0 | | per LM |
| `Laserlite 2000 5-Rib` | 0.00 | index.html:22578 | `matchRate` 23128 | Conditional | Critical — silently $0 | | per LM |

---

## 3. Flashings + box-gutter girth rate ($/LM and $/m² × $/LM)

Two parallel systems: `DEFAULT_RATES` flashing entries ($/LM) drive `matchRate`, while `FLASHING_RATES.standard / .solarspan` drive `buildPricingJson()` line items by girth (m²-style cost = girthM × lengthM × rate).

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `Ridge Cap` | 20.00 | index.html:22580 | `matchRate` 23136 | Conditional | High | | per LM |
| `Barge Flashing` | 20.00 | index.html:22581 | `matchRate` 23137; also reused for fascia board 23419 | Conditional | High | | per LM |
| `Back Flashing` | 20.00 | index.html:22582 | `matchRate` 23138; reused for channel 23413 | Conditional | High | | per LM |
| `Gutter Flashing` | 20.00 | index.html:22583 | `matchRate` 23139 | Conditional | High | | per LM |
| `FLASHING_RATES.standard` | 20 | index.html:22963 | `buildPricingJson` (girth-based line item costing, index.html:~27604) | Conditional | High | | per LM girth (rate per LM of unfolded flashing) |
| `FLASHING_RATES.solarspan` | 25 | index.html:22963 | `buildPricingJson` (used for Solarspan / Stratco CGI jobs) | Conditional | High | | per LM girth |
| `GUTTER_RATES.standard` | 22 | index.html:22962 | Legacy fallback (consumers now go via `DEFAULT_RATES['Patio Gutter']`) | Low (deprecated) | Low — duplicate, could drift from canonical | | per LM (delete if not used) |
| `GUTTER_RATES.box` | 30 | index.html:22962 | Legacy fallback (canonical = `DEFAULT_RATES['Box Gutter']`) | Low (deprecated) | Low — duplicate, could drift | | per LM (delete if not used) |

**Action:** Owner should decide whether `GUTTER_RATES` should be deleted entirely so there is no parallel source of truth.

---

## 4. Gutters and drainage ($/LM)

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `Patio Gutter` | 22.00 | index.html:22585 | `matchRate` 23142 | Conditional (almost always) | High | | per LM |
| `Box Gutter` | 30.00 | index.html:22586 | `matchRate` 23141 | Conditional (box-gutter jobs) | High | | per LM |
| `Downpipe 95x45` | 22.22 | index.html:22587 | `matchRate` 23143, 23157 (elbow); calculated as "$40 per 1800mm stick" | Conditional | High | | per LM (or confirm "per stick" pricing approach) |

---

## 5. Roof plumber labour (box gutter installs)

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `LABOUR_RATES.roof_plumber_day` | 0 | index.html:22964 | `buildJobRows` 23615 — auto-added when `houseGutter='box' && connection='riser'` | Conditional (box+riser jobs); guarded by validator | **Critical** — entire roof plumber line silently costs $0 | | per day |

---

## 6. Risers, brackets, fixings, hardware

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `Riser 76×38 (ea)` | 0.00 | index.html:22592 | `matchRate` 23408–23409 (fallback `\|\| 50`) | Conditional | High — fallback hides miss | | per item |
| `Riser 75×50 (ea)` | 0.00 | index.html:22593 | `matchRate` 23407 (fallback `\|\| 55`) | Conditional | High — fallback hides miss | | per item |
| `Riser 100×50 (ea)` | 60.00 | index.html:22594 | `matchRate` 23406 (fallback `\|\| 60`); also `RISER_PRICES['100×50×2']` at 22637 | Conditional | High | | per item |
| `Riser Bracket (ea)` | 0.00 | index.html:22595 | `matchRate` 23410 (fallback `\|\| 12` for rafter bracket); 23418 (fallback `\|\| 12` for fascia bracket) | Conditional | High — fallback hides miss | | per item |
| `Rafter Bracket (ea)` | 20.00 | index.html:22596 | `matchRate` (galv hardware) | Conditional | Medium | | per item |
| `Tubing Bracket (ea)` | 0.00 | index.html:22597 | `matchRate` 23415 | Conditional | High — silently $0 | | per item |
| `Fixings ($/sqm)` | 0.00 | index.html:22598 | `buildJobRows` 23601 (auto-add by patio area). Phase 1 dropped the silent $2.50 fallback. | Always (every job has fixings) | **Critical** — every job pays fixings; quote blocked until set | | per sqm |
| `Concrete Kwikset (bag)` | 10.00 | index.html:22599 | `matchRate` 23412 (fallback `\|\| 5`) | Conditional | Medium | | per bag |
| `Gable Infill (sqm)` | 0.00 | index.html:22589 | `matchRate` 23405 | Conditional (gable jobs) | High — silently $0 | | per sqm |
| `Infil Panel Twinwall 700mm` | 38.08 | index.html:22590 | Material modal | Conditional | Medium | | per item |
| `Infil Panel Twinwall 1050mm` | 43.01 | index.html:22591 | Material modal | Conditional | Medium | | per item |

---

## 7. Riser fixed-price table (RISER_PRICES)

Parallel to `DEFAULT_RATES` riser entries. Consumed by `buildJobRows` line ~23570 for "welded L" riser items. Must stay in sync with the `DEFAULT_RATES` rows above.

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `RISER_PRICES['76×38×1.6']` | 0 | index.html:22635 | `buildJobRows` (welded L) | Conditional | High — silently $0 | | per item |
| `RISER_PRICES['75×50×2']` | 0 | index.html:22636 | `buildJobRows` (welded L) | Conditional | High — silently $0 | | per item |
| `RISER_PRICES['100×50×2']` | 60 | index.html:22637 | `buildJobRows` (welded L) | Conditional | High | | per item |

---

## 8. Labour rates (per-job inputs and card defaults)

`DEFAULT_RATES` holds nominal `$0/day` placeholders for these — they are entered per job in the Labour card. The Labour card UI uses hourly rates (cost + sell, trades + labourers) via the Settings panel.

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `DEFAULT_RATES['Skilled Trade']` | 0.00 | index.html:22601 | Rates panel display only (labour now entered per job) | Optional | Low | | per day (legacy, may be removable) |
| `DEFAULT_RATES['Labourer']` | 0.00 | index.html:22602 | Rates panel display only | Optional | Low | | per day (legacy) |
| `DEFAULT_RATES['Electrician']` | 0.00 | index.html:22603 | Rates panel display only | Optional | Low | | per day (legacy) |
| Trades **cost** rate | 45 | index.html:3902 (input default); 23713 (fallback in `getLabourFromCard`) | `getLabourFromCard` 23713 → labour line item | Always when labour > 0 | **Critical** — wrong labour rate scales the whole job | | per hour |
| Trades **sell** rate | 110 | index.html:3906; 23714 | `getLabourFromCard` 23714 | Always when labour > 0 | **Critical** | | per hour |
| Labourer **cost** rate | 35 | index.html:3910; 23715 | `getLabourFromCard` 23715 | Conditional | High | | per hour |
| Labourer **sell** rate | 90 | index.html:3914; 23716 | `getLabourFromCard` 23716 | Conditional | High | | per hour |
| Hours per day | 8 | index.html:3918; 23712 | Day-rate ↔ hour-rate compatibility math | Always | Medium — affects day-rate displayed but not the underlying cost (cost is hourly) | | hours |

---

## 9. Hardcoded literals inside the cost calculation (no rate key)

These numbers live in code, not in a rate table. They cannot be edited via the Rates UI and are not in Supabase. **Owner must approve each one or commit to moving it into a rate table.**

| Pricing key (literal) | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| Gable truss fabrication $/m of width | 93 | index.html:23510 | `buildJobRows` gable-truss branch — `fabCostPerTruss = trussWidthM * 93` | Conditional (gable jobs) | **Critical** — every gable truss in the job uses this single magic number | | per LM of truss width |
| Gable truss steel $/LM (overrides STEEL_RATES) | 15.50 | index.html:23512 | `buildJobRows` gable-truss branch — `steelCostPerTruss = steelLM * 15.50` | Conditional (gable jobs) | **Critical** — diverges from STEEL_RATES which the rest of the tool trusts | | per LM |
| `matchRate` fallback "Riser 100×50" | 60 | index.html:23406 | `matchRate` when storedRates entry missing | Conditional | High — masks a missing rate | | per item (or remove fallback) |
| `matchRate` fallback "Riser 75×50" | 55 | index.html:23407 | `matchRate` | Conditional | High — masks missing rate | | per item (or remove fallback) |
| `matchRate` fallback "Riser 76×38" | 50 | index.html:23408–23409 | `matchRate` (appears twice) | Conditional | High — masks missing rate | | per item (or remove fallback) |
| `matchRate` fallback rafter bracket | 12 | index.html:23410 | `matchRate` | Conditional | High — masks missing rate | | per item (or remove fallback) |
| `matchRate` fallback fascia bracket | 12 | index.html:23418 | `matchRate` | Conditional | High — masks missing rate | | per item (or remove fallback) |
| `matchRate` fallback kwikset bag | 5 | index.html:23412 | `matchRate` | Conditional | Medium | | per bag (or remove fallback) |

**Recommendation:** delete every `|| N` numeric fallback in `matchRate` so that a missing rate produces a `0` that the Phase 1 validator catches.

---

## 10. Multipliers, factors, policies

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `DEFAULT_SELL_MARKUP` (material markup) | 1.35 | index.html:22606 | All `buildJobRows` sell-price calcs (lines 23515, 23540, 23557, 23572, 23578, 23604, 23616) | Policy — Always | **Critical** — sets the gross profit on every material line | | percentage (1.35 = 35% markup) |
| Reverse skillion uplift | 1.08 | index.html:24246–24247 | `updatePricing` — applied to total `matCost` AND `matSell` for `calc.isReverse` jobs | Conditional (reverse skillion jobs) | High — 8% lift may double up with already-inflated box-gutter steel | | percentage (1.08 = +8%) |
| GST | 0.10 | index.html:24346 (primary); also index.html:27837, 35916; decking.html:1516, ~4731 | `updatePricing`, `buildPricingJson`, `patioQA._getPricingSnapshot`, decking | Policy — Always | Medium — Australian GST is statutory 10%, so the value is fixed by law, but every site that uses it must agree | | percentage (0.10) |
| Estimate range — low | 0.90 | index.html:6505 | `updateEstimateRange()` — preliminary estimate rounding | Optional (display only) | Low | | percentage |
| Estimate range — high | 1.15 | index.html:6506 | `updateEstimateRange()` | Optional | Low | | percentage |
| Estimate range — GST factor | 1.1 | index.html:6504 | `updateEstimateRange()` | Optional | Low | | percentage |
| Estimate range rounding | 500 | index.html:6505–6506 | Rounds estimate to nearest $500 | Optional | Low | | dollars |
| Sales commission rate | 0.10 | index.html:24349 (`updatePricing`); index.html:35919 (`patioQA`); index.html:~27834 (estimate snapshot); decking.html:1559, 4731 | Subtracted from grossMargin to compute reported margin | Policy — Always | High — directly affects "true margin" reported to scoper | | percentage |
| Margin target (green) | > 20% | index.html:24368; decking.html:1538 | Margin chip colour + `patioQA` flag | Policy | Low (display) — but scoper acts on it | | percentage |
| Margin target (amber) | 10–20% | index.html:24368; 36032 (P-PR2 amber flag); decking.html:1538 | Margin chip | Policy | Low | | percentage |
| Margin target (red) | < 10% | index.html:24368; decking.html:1538 | Margin chip | Policy | Low | | percentage |
| Labour day-rate minimum flag | 300 | index.html:36034 (P-PR3 amber) | `patioQA` scope check | Policy | Low (warning) | | per day |
| Deposit % default | 20 | index.html:3609 (input default); also reused in `buildPricingJson` 27656 onwards | Quote PDF deposit terms | Policy — Always | High — flows into the client-facing invoice | | percentage |
| Deposit council fees default | 0 | index.html:3615 | Quote PDF deposit calc | Policy | Low (per-job override) | | dollars |
| Quote validity | 30 days | index.html (PDF copy); supabase send-quote 400, 488 | Quote PDF + client view page | Policy | Low | | days |

---

## 11. Extras presets (`addExtra`) — fallback values when Settings aren't filled in

Every preset has the shape `sd.scopeX || N`. The `|| N` fallback is what fires if Settings is blank. The "Approved value" column should be the Settings value; the fallback should ideally be removed.

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `scopeFootings` (concrete footing) | 85 | index.html:23318 (settings default); 23643 (addExtra fallback); 23362 (`getSettingsDefaults`) | Concrete Footings extra, qty = nPosts | Optional | Medium | | per footing |
| `scopeElectrical` | 0 | index.html:23325; 23644; 23362 | Electrical extra | Optional | High — silent $0 if added | | per job |
| Downlights (hardcoded) | cost 50, sell 85 | index.html:23645 | Downlights extra, default qty 4 | Optional | High — hardcoded, not in settings | | per item |
| `scopeDemo` | 500 | index.html:23319; 23646; 23362 | Demolition extra | Optional | High | | per job |
| `scopeDelivery` | 200 | index.html:23324; 23647; 23362 | Delivery extra | Optional | Medium | | per job |
| `scopeCrane` | 600 | index.html:23320; 23648; 23362 | Crane Hire extra | Optional | Medium | | per job |
| `scopePermit` | 350 | index.html:23321; 23649; 23362; 24130 | Council/Permit extra | Optional | Medium | | per job |
| `scopeSoakwell` | 800 | index.html:23322; 23650; 23362 | Soakwell extra | Optional | Medium | | per job |
| `scopeSkip` | 350 | index.html:23323; 23651; 23362; 24129 | Skip Bin extra | Optional | Medium | | per job |
| `scopeCeilingFan` | 250 | index.html:23652 (only — no `getSettingsDefaults` entry) | Ceiling Fan extra | Optional | Medium — drifts from other settings because no settings row exists | | per item |
| Settings markup | 35 (%) | index.html:23362 (`getSettingsDefaults`) | `addExtra` multiplier `mk = (sd.markup||35)/100 + 1` | Policy — Optional (only affects extras sell prices) | Medium — silently changes extras pricing | | percentage |
| Settings dayRate (legacy) | 400 | index.html:23362 | Unreferenced in the active labour path (legacy) | Low | Low | | per day (or remove) |
| Settings trades (legacy) | 2 | index.html:23362 | Legacy | Low | Low | | count (or remove) |
| Settings days (legacy) | 1.5 | index.html:23362 | Legacy | Low | Low | | days (or remove) |
| `calculateDemoCost()` return | 0 | index.html:5978 | Currently hardcoded to return 0; demo cost is captured via the addExtra "demo" preset instead | Policy | Low — but easy to misread as a placeholder | | dollars (per job) |

---

## 12. Waste / length adjustments inside `getItemLength`

Not prices, but they affect the multiplier applied to `$/LM`. A change here moves the cost of every flashing, beam, sheet.

| Pricing key (literal) | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| Flashing/gutter join allowance | +0.2 m, capped at 6.5 m | index.html:23431 | `getItemLength` (barge, flashing, gutter, channel) | Always when these are used | Medium — silently changes LM × $/LM | | metres |
| Beam length cap | 8.0 m | index.html:23432 | `getItemLength` (beam, ridge, fascia board) | Always | Medium | | metres |
| Sheet rafter overage | +50 mm, rounded up to nearest 100 mm | index.html:23438–23439 | `getItemLength` (sheets / solarspan) | Always when sheets present | Medium — silently undercounts $ if changed | | mm |
| Downpipe sticks per run (≤3.5 m post) | 2 sticks × 1.8 m | index.html:23443 | `getItemLength` (downpipes) | Always when downpipes | Medium | | sticks of 1.8 m |
| Downpipe sticks per run (>3.5 m post) | 3 sticks × 1.8 m | index.html:23443 | `getItemLength` (downpipes) | Conditional | Medium | | sticks of 1.8 m |
| Strut length | 0.5 m | index.html:23445 | `getItemLength` | Conditional | Low | | metres |
| Welded L length | 0.5 m | index.html:23446 | `getItemLength` | Conditional | Low | | metres |

---

## 13. Stock-length tables (affect $ via stockLength × rate)

`STEEL_STOCK_LENGTHS_BY_SIZE` controls which stock lengths the nesting calculator can pick. Owner should confirm each list reflects what the supplier actually sells, because the cost calc multiplies the **chosen stock length** by `$/LM`, not the cut length.

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `STEEL_STOCK_LENGTHS_BY_SIZE['50×25×1.6']` | [6500, 8000] | index.html:22611 | `calculateStockRequired` / `nestCuts` | Conditional | Medium | | mm |
| `'65×35×2'` | [6500, 8000] | 22612 | as above | Conditional | Medium | | mm |
| `'75×35×2'` | [6500, 8000] | 22613 | | Conditional | Medium | | mm |
| `'76×38×1.6'` | [3000, 4000, 6100, 7300, 8000] | 22614 | | Conditional | Medium | | mm |
| `'75×50×2'` | [8000] | 22615 | | Conditional | Medium | | mm |
| `'100×50×2'` | [5500, 6500, 8000] | 22616 | | Conditional | Medium | | mm |
| `'150×50×2'` | [5500, 6500, 8000] | 22617 | | Conditional | Medium | | mm |
| `'150×50×3'` | [8000] | 22618 | | Conditional | Medium | | mm |
| `'125×50×2'` | [6500, 8000] | 22619 | | Conditional | Medium | | mm |
| `'90×90×2'` | [3100, 4100, 6200, 8000] | 22620 | | Conditional | Medium | | mm |
| `'65×65×2'` | [6500, 8000] | 22621 | | Conditional | Medium | | mm |
| `'75×75×2'` | [6500, 8000] | 22622 | | Conditional | Medium | | mm |
| `'100×100×2'` | [6500, 8000] | 22623 | | Conditional | Medium | | mm |
| `'125×125×3'` | [6500, 8000] | 22624 | | Conditional | Medium | | mm |
| `'150×150×3'` | [6500, 8000] | 22625 | | Conditional | Medium | | mm |
| Saw kerf allowance | 3 mm | index.html (`nestCuts`) | Nesting waste calculation | Always when steel present | Low | | mm |

---

## 14. Server-side validation (send-quote function)

Not values to confirm — included so the owner can see which line-item categories the server will block. If new categories should also be required, list them here.

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `REQUIRED_LINE_CATEGORIES` | `steel, roofing, flashings, gutters, labour` | supabase/functions/send-quote/index.ts:279 | `validatePricingSnapshot` — line items in these categories must have `total_cost > 0` and `total_sell > 0` | Always | High — a category not listed here can still ship with $0 | | category names |
| `pricing_validation_passed` enforcement | rejects on `=== false` | supabase/functions/send-quote/index.ts:286–298 | `/send` endpoint | Always | High | | boolean |
| Totals must be > 0 | inc-GST + ex-GST | supabase/functions/send-quote/index.ts:303–311 | `validatePricingSnapshot` | Always | Critical | | dollars |

---

## 15. Supabase pricing source (currently a one-way mirror)

`loadSupabasePrices()` fetches `confirmed_prices` from `https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api?action=confirmed_prices` and merges them into `storedRates` for keys that already exist in `DEFAULT_RATES` (index.html:22996–23022). **Action items for the owner:**

| Question | Where it lives | Approved answer needed |
|---|---|---|
| What is the canonical price list table in Supabase? | `ops-api` edge function — not in this repo | |
| Should the API ever return a `0` price? | If "yes", the validator will flag it; recommend the API filter zero rows out. | |
| Which user can edit confirmed_prices? | Not visible here — owner to confirm RBAC | |
| API key embedded in client at index.html:22987 | Currently hardcoded fallback `097a1160...` | Confirm whether this is the prod key |

---

## 16. `decking.html` — independent pricing logic (drifts from patio)

The decking tool has its own constants and does not consume any of the patio rates. Numbers here need their own approval pass.

### 16a. Board, joist, bearer, post costs ($/LM)

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `BOARD_TYPES.merbau.costPerLM` ['90x19'/'140x19'/'140x32'] | 8.50 / 12.50 / 18.00 | decking.html:849–850 | `getMaterials` | Conditional | High | | per LM |
| `BOARD_TYPES.spotted_gum.costPerLM` | 10.00 / 15.00 / 22.00 | decking.html:851 | `getMaterials` | Conditional | High | | per LM |
| `BOARD_TYPES.jarrah.costPerLM` | 11.00 / 16.00 / 24.00 | decking.html:852 | `getMaterials` | Conditional | High | | per LM |
| `BOARD_TYPES.blackbutt.costPerLM` | 9.50 / 14.00 / 20.00 | decking.html:853 | `getMaterials` | Conditional | High | | per LM |
| `BOARD_TYPES.treated_pine.costPerLM` | 3.50 / 5.00 / 7.50 | decking.html:854 | `getMaterials` | Conditional | High | | per LM |
| `BOARD_TYPES.trex.costPerLM` | 14.00 / 20.00 / 28.00 | decking.html:855 | `getMaterials` | Conditional | High | | per LM |
| `BOARD_TYPES.modwood.costPerLM` | 12.00 / 18.00 / 25.00 | decking.html:856 | `getMaterials` | Conditional | High | | per LM |
| `BOARD_TYPES.cleverdeck.costPerLM` | 13.00 / 19.00 / 26.00 | decking.html:857 | `getMaterials` | Conditional | High | | per LM |
| `JOIST_COSTS['90x45']` | 6.50 | decking.html:860 | `getMaterials` | Conditional | High | | per LM |
| `JOIST_COSTS['140x45']` | 9.00 | decking.html:860 | `getMaterials` | Conditional | High | | per LM |
| `JOIST_COSTS['190x45']` | 13.00 | decking.html:860 | `getMaterials` | Conditional | High | | per LM |
| `BEARER_COSTS['140x45']` | 9.00 | decking.html:861 | `getMaterials` | Conditional | High | | per LM |
| `BEARER_COSTS['190x45']` | 13.00 | decking.html:861 | `getMaterials` | Conditional | High | | per LM |
| `BEARER_COSTS['240x45']` | 18.00 | decking.html:861 | `getMaterials` | Conditional | High | | per LM |
| `BEARER_COSTS['290x45']` | 24.00 | decking.html:861 | `getMaterials` | Conditional | High | | per LM |
| `POST_COSTS['90x90']` | 12.00 | decking.html:862 | `getMaterials` | Conditional | High | | per LM |
| `POST_COSTS['100x100']` | 15.00 | decking.html:862 | `getMaterials` | Conditional | High | | per LM |
| `POST_COSTS['125x125']` | 22.00 | decking.html:862 | `getMaterials` | Conditional | High | | per LM |
| `POST_COSTS['SHS']` | 28.00 | decking.html:862 | `getMaterials` | Conditional | High | | per LM |
| Joist fallback | `JOIST_COSTS[c.joistSize] \|\| 9` | decking.html:1345 | `getMaterials` | Always when joist size unknown | High — masks missing entry | | per LM (or remove fallback) |
| Bearer fallback | `BEARER_COSTS[c.bearerSize] \|\| 13` | decking.html:1346 | `getMaterials` | Always | High — masks missing entry | | per LM (or remove fallback) |
| Post fallback | `POST_COSTS[c.postSize] \|\| 15` | decking.html:1347 | `getMaterials` | Always | High — masks missing entry | | per LM (or remove fallback) |

### 16b. Balustrade

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `BALUSTRADE_COSTS.none` | 0 | decking.html:869 | `getMaterials` | Always when bal selected | Low | | per LM |
| `BALUSTRADE_COSTS.timber` | 120 | decking.html:869 | `getMaterials` | Conditional | High | | per LM |
| `BALUSTRADE_COSTS.wire` | 180 | decking.html:869 | `getMaterials` | Conditional | High | | per LM |
| `BALUSTRADE_COSTS.glass` | 350 | decking.html:869 | `getMaterials` | Conditional | High | | per LM |
| `BALUSTRADE_COSTS.aluminium` | 220 | decking.html:869 | `getMaterials` | Conditional | High | | per LM |
| Balustrade fallback | `BALUSTRADE_COSTS[c.balStyle] \|\| 150` | decking.html:1448 | `getMaterials` | Conditional | High — fallback masks missing entry | | per LM (or remove) |

### 16c. Fixed component prices

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| Hidden fastener clips (cost / sell) | 45 / 65 | decking.html:1381, 1413 | `getMaterials` | Conditional | Medium | | per box of 100 |
| Deck screws 10g × 65 mm (cost / sell) | 55 / 80 | decking.html:1385, 1416 | `getMaterials` | Conditional | Medium | | per box of 500 |
| Joist hangers galv (cost / sell) | 3.50 / 5.00 | decking.html:1401, 1426 | `getMaterials` | Conditional | Medium | | per item |
| Post stirrups bolt-down (cost / sell) | 18 / 28 | decking.html:1431 | `getMaterials` | Conditional | Medium | | per item |
| Dynabolts M12 (cost / sell) | 2.50 / 4.00 | decking.html:1432 | `getMaterials` | Conditional | Low | | per item |
| Concrete bags 20 kg (cost / sell) | 8 / 12 | decking.html:1435 | `getMaterials` | Conditional | Medium | | per bag |
| Stair stringer (cost / sell) | 45 / 70 | decking.html:1442 | `getMaterials` | Conditional | Medium | | per item |
| Balustrade posts (cost / sell) | 25 / 40 | decking.html:1451 | `getMaterials` | Conditional | Medium | | per item |

### 16d. Decking policies and waste

| Pricing key | Current value | Source file:line | Used by | Required for quoting | Risk if missing/wrong | Approved value needed | Recommended unit |
|---|---|---|---|---|---|---|---|
| `MARKUP` (decking material markup) | 1.45 | decking.html:870 | All sell-price calcs (`getMaterials`) | Policy — Always | **Critical** — sets GP on every decking line; differs from patio (1.35) | | percentage (1.45 = 45%) |
| Labour sell fallback | `labCost × 1.5` | decking.html:1505 | `updatePricing` (decking) when no manual sell entered | Always when labour > 0 | High — silently +50% if user forgets to set sell | | percentage |
| Board waste factor | 1.08 (8%) | decking.html:1252–1253 | `getMaterials` (multi-zone board count) | Always | Medium | | percentage |
| GST | 0.10 | decking.html:1516 | `updatePricing` (decking) | Policy | Low | | percentage |
| Commission | 0.10 | decking.html:1559; 4731 | `updatePricing`; `buildPricingJson` (decking) | Policy | High | | percentage |
| Margin colour thresholds (green/amber/red) | >20% / 10–20% / <10% | decking.html:1538 | Margin chip | Policy | Low (display) | | percentages |
| Deposit (decking) | 20% | decking.html:4778 | `buildPricingJson` | Policy | High | | percentage |

---

## 17. Cross-cutting actions (not specific values, but decisions the owner has to make)

1. **Reconcile `DEFAULT_RATES` and `STEEL_RATES`** — same steel sizes appear in both; updating one will not update the other. Decide which is canonical.
2. **Decide whether `GUTTER_RATES` and `FLASHING_RATES` should be deleted** — both have parallel keys in `DEFAULT_RATES`; they are a second source of truth.
3. **Decide whether the `|| N` fallbacks in `matchRate` and decking `getMaterials` should be removed** — they were the root cause of silent $0 pricing.
4. **Decide whether `calculateDemoCost` should ever return something other than 0** — currently it is a placeholder.
5. **Patio markup is 35% (1.35); decking markup is 45% (1.45)** — confirm this is intentional, or unify.
6. **Confirm the Supabase `confirmed_prices` API key** at index.html:22987 is the production key and rotate if needed.
7. **Decide what the gable-truss formula should be** — 93 and 15.50 are not in any rate table and cannot be edited through the Rates UI.
8. **Decide whether `LABOUR_RATES.roof_plumber_day` should be set globally, or asked per job** — it is auto-added but currently $0.
9. **Hours per day (8) drives the day-rate ↔ hour-rate compatibility math** — confirm that 8 hours is the standard scoping assumption.
10. **The 30-day quote validity** is hardcoded in PDF copy and the send-quote function — confirm policy.

---

*Generated 2026-05-26 from a static read of `/Users/nithinsilas/patio` at commit `954568d`. No prices were invented or estimated; every "Current value" reflects what is in the code right now. Update this file alongside any rate change.*
