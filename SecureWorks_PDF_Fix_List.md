# SecureWorks Patio Configurator — PDF Output Fix List

## How to use this document
This lists every issue found across the configurator's PDF outputs. Fixes are prioritised. Each fix describes WHAT is wrong and WHAT the correct behaviour should be — not HOW to code it. The developer should determine the best implementation approach within the existing codebase.

---

## CRITICAL — Will cause wrong orders, site errors, or contradictions

### 1. Post embedment vs cut length contradiction
**Affects:** Work Order (all roof types)
**Problem:** Key Dimensions says "Post cut length: XXXXmm (inc. 300 in ground)" implying 300mm below FFL. But Construction Details (Detail B) says "Post embedment: 100mm into concrete." These describe different installation methods.
**Fix:** Decide on one method and make it consistent. Recommended: post embedment = 300mm into concrete (the post sits 300mm into the footing). Update Detail B to say "Post embedment: 300mm into concrete." The footing depth (600mm) minus embedment (300mm) = 300mm of concrete below the post base, which is structurally sound. Post cut length = post height above FFL + 300mm embedment. Both numbers must derive from the same source variable.

### 2. Sheet order length is impossible
**Affects:** Work Order materials list, Sheets Order
**Problem:** Sheets are listed at a length shorter than the required cut length (e.g., "3000mm — cut to 3096mm on site" or "2.23m — cut to 2284mm on site"). You cannot cut material longer than what you ordered.
**Fix:** The order length must be LONGER than the cut length. Order length = next standard available length above the cut length (e.g., if cut length is 3096mm, order 3100mm or 3200mm). Alternatively, order at exact cut length if supplier can cut to size. The work order materials list should show: "[qty]× [product] [ORDER length]mm (trim to [CUT length]mm on site)."

### 3. Trusses duplicated across steel order and fab order
**Affects:** Steel Order, Fab Order
**Problem:** Truss steel appears in the Steel Order nesting summary AND the Fab Order specifies "Order length: 6× 6m sticks." This will result in either duplicate steel being ordered or confusion about who supplies the truss material.
**Fix:** Pick one path:
- **Option A (recommended):** Fab shop supplies their own steel. Remove trusses entirely from the Steel Order (both the nesting summary and any line items). The Fab Order is the single source for truss material.
- **Option B:** You supply steel to fab shop. Add trusses as a line item in the Steel Order main table (not just nesting summary) with a note "DELIVER TO [fab shop name]". Remove the "Order length" line from the Fab Order.

### 4. Trusses missing from steel order main table
**Affects:** Steel Order
**Problem:** Trusses appear in the Stock Order Summary/nesting section but NOT in the main order table above. A supplier filling the order from the top table will miss the truss steel.
**Fix:** If truss steel is being ordered from the steel supplier (Option B above), add it as a line item in the main order table. If fab shop supplies their own steel (Option A), remove from nesting summary entirely.

### 5. Riser elbows on wrong supplier order
**Affects:** Sheets Order, Steel Order
**Problem:** Riser elbows (90×90×2 SHS) are listed on the Sheet Metal & Flashings Order. SHS is structural steel — sheet metal suppliers don't stock it.
**Fix:** Either:
- Move riser elbows to the Steel Order as a line item, OR
- Note in the Steel Order nesting summary that riser elbows are cut from post offcuts (if waste is sufficient) and remove from Sheets Order. For example: "Riser Elbows: 5× 500mm — cut from post offcuts, no additional order."

### 6. Back flashing missing from sheets order
**Affects:** Sheets Order
**Problem:** The work order installation sequence says "Install apron flashing to house first" and the Sheets Order has an empty sketch box for "Back Flashing" but no actual line item to order it.
**Fix:** Add back flashing as a line item in the Flashings section of the Sheets Order. Length = overall patio length. Colour = roofing colour (typically). Include in the main table, not just the sketch area.

### 7. Gutter/downpipe colour inconsistency
**Affects:** Sheets Order vs Work Order
**Problem:** The Sheets Order lists gutter and downpipes in the roofing colour (e.g., Shale Grey). The Work Order construction details list gutter in the steel colour (e.g., Woodland Grey). These pull from different source variables.
**Fix:** Gutter and downpipe colour should be a single source variable in the configurator. Industry standard in Perth: gutters and downpipes match the steel/fascia colour, not the roof colour. Both the Sheets Order and Work Order must reference the same variable.

---

## IMPORTANT — Causes confusion or looks unprofessional

### 8. "Other Fabricated Items" table on fab order is wrong
**Affects:** Fab Order
**Problem:** The table at the bottom shows "Trusses 76×38×1.6 — 2.23m — 4" but 2.23m is the sheet cut length, not the truss dimension. Truss span is 4400mm.
**Fix:** This table should show fabricated items with correct dimensions. For trusses: span (4400mm), not sheet length. Or remove this table entirely since the detailed truss specs above it already cover everything.

### 9. Fascia height hardcoded on gable work orders
**Affects:** Work Order (gable roof type)
**Problem:** Key Dimensions shows "Fascia height: 2700mm" which is correct for a skillion but doesn't apply to a gable. On the gable build, posts are 3300mm and beam height is 3240mm.
**Fix:** Fascia height should be calculated from the actual geometry, not hardcoded. For a gable: fascia height = beam height (front beam height above FFL). Only show this field if it's meaningful for the roof type.

### 10. P2 and P3 both labelled "Front mid"
**Affects:** Work Order — Post Schedule
**Problem:** On a 4-post patio, P2 and P3 are both described as "Front mid" which doesn't help the crew distinguish them.
**Fix:** Use chainage-based descriptions: "Front @ 1733mm" and "Front @ 3466mm" — or "Front centre-left" and "Front centre-right."

### 11. Cutting instruction buried in item name
**Affects:** Sheets Order
**Problem:** "SpanPlus 330 Sheets — last sheet cut to 250mm" has the cutting note in the product name field.
**Fix:** Item name should just be "SpanPlus 330". Move "last sheet cut to 250mm cover width" to the Notes column.

### 12. Gable infill material not specified
**Affects:** Sheets Order
**Problem:** "Gable Infill — 2.23m — 2 — Woodland Grey" doesn't specify what material it is (flat sheet, Mini Orb, custom).
**Fix:** Specify the product type, e.g., "Colorbond Flat Sheet" or "Mini Orb" or whatever the default infill material is.

### 13. Purlin count mismatch (gable)
**Affects:** Work Order vs Materials List
**Problem:** Installation sequence says "3× purlins at 1000mm centres" but materials list shows "10× purlins." The installation step doesn't clarify per-side count or total.
**Fix:** Installation step should specify: "[X] purlins per side × 2 sides = [total] purlins at [spacing]mm centres." Must match materials list total.

### 14. Downpipe length inconsistency (gable)
**Affects:** Work Order Materials vs Construction Details
**Problem:** Materials list shows downpipes at 3300mm (auto-calculated from post height). Construction Details shows "1800mm (nested)."
**Fix:** Both should reference the same calculated value. Downpipe length = post height (or beam height to ground). The "nested" note refers to joining two shorter lengths for transport — if the actual run is 3300mm, the detail should say "2× 95×45mm — nested to 3300mm" or specify the actual pieces needed.

### 15. Clarify "Fascia Board (House Wall)" on steel order
**Affects:** Steel Order
**Problem:** Listed as 76×38×1.6 with no description. This is the same profile as a purlin. Unclear if it's a specific product or a purlin repurposed as a wall plate.
**Fix:** Add a note: "Wall plate / mounting rail" or rename to "Wall Plate 76×38×1.6" to distinguish from purlins.

---

## NICE TO HAVE — Quality of life improvements

### 16. Empty electrical section should auto-hide
**Affects:** Work Order page 1
**Problem:** "ELECTRICAL & LIGHTING" section appears with "Cable chase in SolarSpan panels — install cabling for:" followed by nothing when no electrical is scoped.
**Fix:** If no electrical items are specified in the scope, hide the entire electrical section. Also remove "Run electrical cables in chase first" from the sheeting installation step.

### 17. No client phone number on work order
**Affects:** Work Order page 1
**Fix:** Add client phone number next to "Site contact" on page 1. Crew needs it when they arrive to site.

### 18. No flashing profile dimensions on sheets order
**Affects:** Sheets Order
**Problem:** Sketch boxes for flashing profiles are empty. For email ordering, suppliers need dimensions.
**Fix:** Auto-calculate and populate flashing profile dimensions from roof geometry. At minimum: cover width, upstand height, drip edge depth for back flashing and barge flashings.

### 19. Missing box gutter detail for gable builds
**Affects:** Work Order (gable roof type)
**Problem:** Gable roofs attached to house via riser beam need a box gutter or specific junction detail where the roof meets the house. No detail is provided for water management at this junction.
**Fix:** Add a conditional "Detail E: House Junction" for gable builds that describes the roof-to-house water management approach (box gutter, valley flashing, or apron detail).

### 20. No truss connection/coating spec on fab order
**Affects:** Fab Order
**Problem:** No mention of joint method (weld, bolt, gusset) or coating requirement (galv, powder coat, pre-painted).
**Fix:** Add fields for: Connection method (default: "Fully welded"), Finish (default: "Powder coat to [colour]"), and any special requirements.

### 21. Supplier account numbers and email pre-fill
**Affects:** All supplier orders
**Fix:** Add supplier dropdown in configurator with pre-filled: supplier name, account number, email, delivery address. Allows one-click email with correct PDF attached.

### 22. "Required by" date auto-calculation
**Affects:** All supplier orders
**Fix:** Auto-populate "Required by" based on install date minus lead time. Steel: install date minus 5 business days. Sheets/flashings: install date minus 3 business days. Fab: install date minus 10 business days (or configurable).

### 23. Missing reference to flashings page
**Affects:** Work Order installation sequence
**Problem:** Step 9 (Flashings) says "Verify profiles match drawings (Flashings page)" but there is no flashings page in the work order.
**Fix:** Either add a flashings detail page with profile drawings, or remove the reference.

### 24. Work order document split
**Affects:** Work Order (all types)
**Problem:** 9 pages is too long for on-site use. Crews won't read it.
**Fix:** Consider splitting into three outputs:
- **Site Sheet (2 pages):** Job summary + cutting plan on page 1, site plan render + key dimensions on page 2
- **Full Scope Pack (current 9 pages, cleaned up):** For office use, material ordering, QA, and new subbie reference
- **Sign-Off Sheet (1 page):** Standalone completion checklist + signature block, goes to site separately
This is a structural change — implement after all other fixes are complete.
