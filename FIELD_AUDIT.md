# Complete Input Field Audit — Patio Configurator

**File:** `/home/user/patio/index.html` (~13,600 lines, single-file application)

---

## GROUP: ASSESSMENT

---

### JOB DETAILS (`id="sec-job"`)

- Field: `jobRef`
  Type: text input
  Default: (empty)
  Placeholder: "SW250208-01"

- Field: `salesperson`
  Type: select
  Options: Nithin, Marnin, Other
  Default: "Nithin"

- Field: `clientEmail`
  Type: text input
  Default: (empty)
  Placeholder: "client@email.com"

- Field: `customerName`
  Type: text input
  Default: (empty)
  Triggers: `updateCustomer()`

- Field: `customerAddress`
  Type: text input
  Default: (empty)
  Triggers: `updateCustomer()` — spans 2 columns

- Field: `customerPhone`
  Type: text input
  Default: (empty)
  Placeholder: "0412 345 678"
  Triggers: `updateCustomer()`

- Field: `clientName`
  Type: hidden input
  Purpose: Legacy save/load compat (synced from customerName)

- Field: `siteAddress`
  Type: hidden input
  Purpose: Legacy save/load compat (synced from customerAddress)

- Field: `clientPhone`
  Type: hidden input
  Purpose: Legacy save/load compat (synced from customerPhone)

---

### SITE (`id="sec-site"`) — Collapsed by default

- Field: `existingSite`
  Type: select
  Options: Clear site (`clear`), Old patio/pergola (`patio`), Shade sail/posts (`shadesail`), Existing deck (`deck`), Other - see notes (`other`)
  Default: "clear"
  Triggers: `updateExistingSite()` — controls `demoScopeGroup` visibility

- Field: `demoScope`
  Type: select
  Options: N/A (`na`), We remove & dispose (`us`), Client to remove (`client`), Keep/modify existing (`keep`)
  Default: "us"
  Conditional: Only visible when `existingSite !== "clear"`

- Field: `siteAccess`
  Type: toggle button group → hidden input
  Options: Easy, Moderate, Difficult
  Default: "easy"

- Field: `groundSurface`
  Type: toggle button group → hidden input
  Options: Slab, Paving, Grass, Deck
  Default: "grass"

- Field: `fasciaMaterial`
  Type: toggle button group → hidden input
  Options: Timber, Metal, Fibre Cement
  Default: "timber"

- Field: `wallType`
  Type: toggle button group → hidden input
  Options: Double Brick, Brick Veneer, Rendered
  Default: "doublebrick"

- Field: `existingRoof`
  Type: toggle button group → hidden input
  Options: Tiles, Colorbond, Flat
  Default: "tiles"

- Field: `existingGutter`
  Type: toggle button group → hidden input
  Options: Quad, OG, Square, Fascia
  Default: "quad"

- Field: `siteNotes`
  Type: textarea (hidden)
  Purpose: Backward compatibility — `display:none`

- Field: `jobNotes`
  Type: textarea (hidden)
  Purpose: Backward compatibility — `display:none`

---

## GROUP: DESIGN

---

### DIMENSIONS (`id="sec-dimensions"`) — Collapsed by default

- Field: `inWidth`
  Type: number input
  Label: Projection (m)
  Default: 3
  Step: 0.1

- Field: `inLength`
  Type: number input
  Label: Length (m)
  Default: 6
  Step: 0.1

- Field: `inPostHeight`
  Type: number input
  Label: Post Height (m)
  Default: 2.4
  Step: 0.1

---

### DESIGN (`id="sec-design"`) — Collapsed by default

- Field: `inRoofStyle`
  Type: select
  Options: Gable (`gable`), Skillion (`skillion`), Hip (`hip`)
  Default: "gable"
  Note: gable and hip disabled when connection=wall; wall disabled when isGable

- Field: `inPitch`
  Type: number input
  Label: Pitch (deg)
  Default: 10
  Step: 0.5
  Container: `pitchField` — always visible

- Field: `inRoofing`
  Type: select
  Label: Material
  Options: SolarSpan 75mm (`solarspan75`), SolarSpan 100mm (`solarspan100`), Trimdek (`trimdek`), Corrugated (`corrugated`), Spandek (`spandek`), SpanPlus 330 (`spanplus330`)
  Default: "solarspan75"

- Field: `inBMT`
  Type: select
  Label: Sheet BMT
  Options: 0.42mm (`042`), 0.48mm (`048`)
  Default: "042"
  Conditional: Only visible when roofing = trimdek or corrugated

- Field: `inCeilingFinish`
  Type: select
  Label: Ceiling Finish
  Options: Plain (`plain`), VJ (`vj`)
  Default: "plain"
  Conditional: Only visible for SolarSpan (insulated) panels

- Field: `inInfill`
  Type: select
  Label: Gable Infill
  Options: Colorbond (`colorbond`), Polycarbonate (`polycarbonate`), Louvre (`louvre`), None (`none`)
  Default: "colorbond"
  Conditional: Only visible for Gable/Hip roof style

#### Colour Pickers (JS-rendered chip selectors)

- Field: `sheetColor` (JS variable, via `sheetChips` div)
  Type: colour chip picker
  Label: Sheets colour
  Options: COLORS array (standard Colorbond colours)
  Default: "Monument"
  Display: Selected colour shown in `sheetLabel` span

- Field: `steelColor` (JS variable, via `steelChips` div)
  Type: colour chip picker
  Label: Steel colour
  Options: Same COLORS array
  Default: "Monument"
  Display: Selected colour shown in `steelLabel` span

#### Polycarbonate Sub-section (`polycarbField`)

Conditional: Only visible when roofing = trimdek, corrugated, spandek, or spanplus330

- Field: `polycarb` (radio group, name="polycarb")
  Type: radio buttons
  Options: Yes / No
  Default: "no"
  Controls: `polycarbOptions` div visibility

- Field: `inPolycarbBrand`
  Type: select
  Options: Ampelite Solasafe (`ampelite`), Laserlite 2000 (`laserlite`)
  Default: "ampelite"
  Conditional: Only visible when polycarb = yes

- Field: `inPolycarbTint`
  Type: select
  Options: Dynamically populated by `updatePolycarbTints()` based on brand
  Conditional: Only visible when polycarb = yes

- Field: `inPolycarbPattern`
  Type: select
  Options: Every 2nd / 1:1 (`2`), Every 3rd / 2:1 (`3`), Every 4th / 3:1 (`4`), Custom (`custom`)
  Default: "3"
  Conditional: Only visible when polycarb = yes

- Field: `inPolycarbLevel`
  Type: select
  Options: Level 1 - Max Light (`1`), Level 2 - Medium (`2`)
  Default: "1"
  Conditional: Only visible when polycarb = yes

- Field: `inPolycarbCustom`
  Type: number input
  Label: Colorbond per 1 polycarb
  Default: 3
  Min: 1, Max: 20, Step: 1
  Conditional: Only visible when polycarb = yes AND pattern = custom

---

### STRUCTURE (`id="sec-structure"`) — Collapsed by default

#### Connection

- Field: `inConnection`
  Type: select
  Label: Attachment
  Options: Riser Beam (`riser`), Flyover (`flyover`), Freestanding (`freestanding`), Fascia/Receiving (`fascia`), Wall Mount (`wall`)
  Default: "riser"
  Note: flyover disabled when not insulated or isGable; wall disabled when isGable

- Field: `inFasciaHeight`
  Type: number input
  Label: Fascia Height (mm)
  Default: 2700
  Conditional: Visible when connection is attached (not freestanding)

- Field: `inFasciaBracketQty`
  Type: number input
  Label: Fascia Brackets
  Default: 4
  Min: 2, Step: 1
  Conditional: Visible when connection = fascia AND isGable

- Field: `inHouseGutter`
  Type: select (hidden)
  Options: Existing Quad Gutter (`quad`), Replace with Box Gutter (`box`)
  Default: "quad"
  Note: `display:none` — retained for calculation compatibility only

- Field: `inRiserHeight`
  Type: number input
  Label: Riser Height (mm)
  Default: 400
  Conditional: Visible when connection = riser

- Field: `inRiserOffset`
  Type: number input
  Label: Riser Offset (mm)
  Default: 150
  Conditional: Visible when connection = riser

- Field: `inRiserQty`
  Type: number input
  Label: Riser Brackets
  Default: (empty/auto — placeholder computed from length)
  Min: 2
  Conditional: Visible when connection = riser

- Field: `inRiserGutter`
  Type: select
  Options: None (`none`), Quad Gutter on Riser Beam (`quad`)
  Default: "none"
  Conditional: Visible when connection = riser AND isGable

#### Posts (Stepper control)

- Field: `inPostQty`
  Type: number input with +/- stepper buttons + "Auto" reset
  Label: Posts
  Default: (empty/auto)
  Min: 2, Max: 20, Step: 1
  Controls: `adjustPostQty()` for +/-, `clearPostQtyOverride()` for Auto

#### Frame Steel

- Field: `inPostSize`
  Type: select
  Options: 65x65 SHS, 75x75 SHS, 90x90 SHS, 100x100 SHS, 125x125 SHS, 150x150 SHS
  Default: "90x90"

- Field: `inPostFix`
  Type: select
  Label: Post Fixing
  Options: In-ground / concrete footings (`concrete`), Baseplate / bolt to slab (`baseplate`)
  Default: "concrete"

- Field: `inBeamSize`
  Type: select
  Options: 75x50 RHS, 100x50 RHS, 150x50 RHS
  Default: "100x50"

---

### GABLE TRUSS CALCULATOR (`id="sec-truss"`)

Conditional: Entire section only visible when roof style = gable

#### Read-only Display Fields

- Field: `trussSpanDisplay` — text (readonly), auto from projection
- Field: `trussPitchDisplay` — text (readonly), auto from roof pitch

#### Editable Inputs

- Field: `inTrusses`
  Type: number input
  Label: Qty
  Default: 3
  Min: 2

- Field: `inOrientation`
  Type: select
  Label: Ridge Direction
  Options: Along House (`lengthways`), Away from House (`crossways`)
  Default: "lengthways"

- Field: `inTrussSteel`
  Type: select
  Label: Steel Size
  Options: 76x38 RHS, 75x50 RHS, 100x50 RHS
  Default: "76x38"

- Field: `inTrussBase`
  Type: select
  Label: Web Style
  Options: King Post (`kingpost`), King Post + Verticals (`kingverticals`), Web (`web`)
  Default: "kingpost"

- Field: `inTrussChord`
  Type: select
  Label: Chord
  Options: Bottom (`bottom`), Mid (`mid`), None (`none`)
  Default: "bottom"

- Field: `inOverhang`
  Type: number input
  Label: Overhang (mm)
  Default: 0
  Min: 0, Step: 10

#### Hidden Inputs (auto-calculated)

- Field: `inPosts` — hidden, default: 3, auto-calculated post count
- Field: `inRafters` — hidden, default: 5, rafter count for skillion
- Field: `trussBoxGutterOn` — hidden, default: "0", tracks box gutter state

#### Truss Options (Checkboxes + Sub-panels)

- Field: `trussExtOn`
  Type: checkbox
  Label: Extender
  Default: unchecked
  Controls: Shows `trussExtInputs` panel

- Field: `trussExtLen`
  Type: number input
  Label: Extender Length (mm)
  Default: 300
  Min: 0, Step: 10
  Conditional: Visible when trussExtOn checked

- Field: `trussRiserOn`
  Type: checkbox
  Label: Risers
  Default: unchecked
  Controls: Shows riser panels + box gutter button

- Field: `trussRiserLock`
  Type: checkbox
  Label: Lock L/R
  Default: checked
  Conditional: Visible when trussRiserOn checked

- Field: `riserType` (radio group: `riserTypeWelded`, `riserTypeSeparate`)
  Type: radio buttons (name="riserType")
  Options: Welded to Truss, Separate Piece
  Default: "welded"
  Conditional: Visible when trussRiserOn checked

- Field: `riserLH`
  Type: number input
  Label: Left Riser Horiz (mm)
  Default: 200, Min: 0, Max: 800, Step: 10
  Conditional: Visible when trussRiserOn checked

- Field: `riserLV`
  Type: number input
  Label: Left Riser Vert (mm)
  Default: 150, Min: 0, Max: 600, Step: 10
  Conditional: Visible when trussRiserOn checked

- Field: `riserRH`
  Type: number input
  Label: Right Riser Horiz (mm)
  Default: 200, Min: 0, Max: 800, Step: 10
  Conditional: Visible when trussRiserOn checked

- Field: `riserRV`
  Type: number input
  Label: Right Riser Vert (mm)
  Default: 150, Min: 0, Max: 600, Step: 10
  Conditional: Visible when trussRiserOn checked

#### Viewport Controls

- `showTrussDims` — checkbox, toggles dimension labels on 3D canvas, default: checked
- View buttons: 3D / Front / Side / Top / Reset
- Fullscreen button
- Box Gutter button — opens `gutterDesignerModal`, conditional on trussRiserOn
- PDF export button

#### Output Displays (read-only)

- `specA` (Span), `specB` (Height), `specC` (Rafter), `specD` (Pitch)
- `specExt` (Extender — conditional), `specRiserL`/`specRiserR` (Riser dims — conditional)
- `specChordCut`, `specRafterCut`, `specRiserLM`, `specLMper`, `specLMall`
- `angleApex`, `angleBase` — mitre angles
- `webStyle`, `webCount`, `webCuts`, `webLM` — web member data (conditional)
- `fabOrder` — fabrication order text
- `cutListBody` — cut list table
- `totalPieces`, `totalLinear`, `stockLengths`

---

### BATTEN / PURLIN CALCULATOR (`id="sec-battens"`)

Always displayed but sub-sections swap based on roof style.

#### Rafters Sub-section (`rafterSubsection`) — Skillion/Hip only

- Field: `inRafterSize`
  Type: select
  Label: Rafter Size
  Options: 75x50, 100x50, 125x50, C150, C200
  Default: "100x50"

- Field: `inRafterSpacing`
  Type: number input
  Label: Spacing (mm)
  Default: 900
  Min: 300, Max: 2400, Step: 50
  Quick-set buttons: 900 / 1000 / 1200

- Field: `inRafterQtyOverride`
  Type: number input with +/- stepper + "Auto" button
  Label: Qty override
  Default: (empty/auto)
  Min: 2, Max: 30, Step: 1

#### Skillion Battens Sub-section (`skillionBattenSubsection`) — Skillion/Hip only

- Field: `extraBattensVal` (span + stepper)
  Type: stepper control (JS-managed, no input element)
  Label: Extra battens for rigidity
  Default: 0

- Field: `bracketType` (radio, name="bracketType")
  Type: radio buttons
  Options: Internal / hidden, slower (`internal`), External / visible, faster (`external`)
  Default: "internal"
  Conditional: Visible when battens needed > 0 AND not insulated roofing

#### Gable Purlins Sub-section (`gableBattenSubsection`) — Gable only

- Field: `gableExtraBattensVal` (span + stepper)
  Type: stepper control (JS-managed, no input element)
  Label: Extra purlins per side
  Default: 0

#### Output Displays (read-only)

- Skillion: `battenSheetLabel`, `battenMaxSpan`, `battenProjection`, `battenPitch`, `battenResultTitle`, `battenResultSpacing`, `battenResultPositions`, `battenResultBrackets`, `battenWarnings`, `battenDiagram` (ASCII)
- Gable: `gableBattenSheet`, `gableBattenMaxSpan`, `gableBattenRafter`, `gableBattenPitch`, `gableBattenResultTitle`, `gableBattenResultBreakdown`, `gableBattenResultSpacing`, `gableBattenResultLineal`, `gableBattenDiagram` (ASCII)

---

## GROUP: SCOPE

---

### SCOPE (`id="sec-scope"`) — Collapsed by default

#### Electrical

- Field: `elecDownlights`
  Type: checkbox
  Label: Downlights
  Default: unchecked

- Field: `elecDownlightsQty`
  Type: number input
  Default: 4, Min: 1, Max: 20

- Field: `elecFan`
  Type: checkbox
  Label: Ceiling Fan
  Default: unchecked

- Field: `elecFanQty`
  Type: number input
  Default: 1, Min: 1, Max: 5

- Field: `elecGPO`
  Type: checkbox
  Label: GPO
  Default: unchecked

- Field: `elecGPOQty`
  Type: number input
  Default: 1, Min: 1, Max: 5

- Field: `electrical`
  Type: select (hidden, `display:none`)
  Options: none, downlights, fan, both
  Default: "none"
  Purpose: Legacy compat — synced by `syncElectricalCheckboxes()`

- Display: `elecSolarSpanNote`
  Conditional: Visible when SolarSpan AND any electrical checked

#### Additional Scope

- Field: `scopeDemo` — checkbox, "Demo existing structure", default: unchecked
- Field: `scopeSkip` — checkbox, "Skip bin", default: unchecked
- Field: `scopePermit` — checkbox, "Council permit required", default: unchecked

---

### FLASHINGS (`id="sec-flashings"`) — Collapsed by default

#### Section Summary View

- `flashSummaryCount` — count of flashings
- `flashJobTable` / `flashJobBody` — summary table (Name, Girth, Length, Qty, Colour, Gauge, Side)
- `flashTotalArea` — total m²
- Per-row: Edit (pencil) and Delete (×) buttons
- "Open Editor" button → opens fullscreen modal

#### Flashing Profile Editor Modal (`flashModalOverlay`)

**Canvas drawing:**
- `flashCanvas` — double-click to add points, drag to pan, scroll to zoom, Shift+double-click for 45° snap
- Displays: `flashGirth` (mm), `flashLegs`, `flashZoom`
- Toolbar: Undo, Clear, Flip H, Flip V

**Colour side toggle:**
- Top / Bottom buttons — JS state only, no hidden input

**End treatments:**

- Field: `flashStartTreat`
  Type: select
  Options: None, Mini Break, Hem
  Default: "none"

- Field: `flashEndTreat`
  Type: select
  Options: None, Mini Break, Hem
  Default: "none"

**Treatment details (visible when any treatment != none):**

- Field: `flashTreatSize`
  Type: number input, Label: Size (mm)
  Default: 10, Min: 3, Max: 30

- Field: `flashTreatAngle`
  Type: number input, Label: Angle (deg)
  Default: 45, Min: 10, Max: 90, Step: 5

- Treatment direction: Out / In toggle buttons — JS state only

**"Add to Job" bar:**

- Field: `flashName`
  Type: text input
  Placeholder: "Apron - Back Wall"

- Field: `flashColour`
  Type: select
  Options: Monument, Woodland Grey, Paperbark, Surfmist, Basalt, Manor Red, Deep Ocean, Windspray
  Default: "Deep Ocean"

- Field: `flashGauge`
  Type: select
  Options: 0.42, 0.48, 0.55
  Default: "0.42"

- Field: `flashLength`
  Type: number input, Label: Length (mm)
  Default: 4500, Step: 100

- Field: `flashQty`
  Type: number input
  Default: 1, Min: 1, Step: 1

**Templates sidebar:** `flashTemplates` — saved thumbnails + "Save Current" tile

---

### NOTES (`id="sec-notes"`) — Collapsed by default

- Field: `noteQuote`
  Type: textarea
  Label: Quote Note (appears on customer quote)
  Default: (empty), Rows: 2

- Field: `noteWorkOrder`
  Type: textarea
  Label: Work Order Note (for install crew)
  Default: (empty), Rows: 2

- Field: `noteInternal`
  Type: textarea
  Label: Internal Note (office only, doesn't print)
  Default: (empty), Rows: 2

---

## GROUP: SALE

---

### PRICING & COSTS (`id="sec-pricing"`) — Collapsed by default

#### Patio Materials (`patioMaterialsTable`)

Dynamic table. Per row:
- Description (read-only), Qty (read-only), Cost (read-only, togglable)
- Sell Price: number input (class `pm-sell-input`) — editable override
- Duplicate button (⊕) — copies to Additional Materials

- Field: `globalMarkupPct`
  Type: number input
  Label: Markup %
  Default: 35, Min: 0, Max: 200, Step: 1
  Note: Duplicate ID exists in Materials Modal

#### Additional Materials (`additionalMaterialsTable`)

Dynamic rows (min 5 visible). Per row:
- Description: text input (placeholder: "Item description")
- Qty: number input (default: 1, step: 1, min: 1)
- Cost: number input (step: 5)
- Sell: number input (step: 5)
- Delete (×) button

Quick-add buttons:
- `+ Electrical` — prefills desc + settings cost
- `+ Extra Post` — "Additional post - 90×90×2 SHS", cost $120
- `+ Skip Bin` — cost from settings ($350)
- `+ Permit` — cost from settings ($350)
- `+ Other` — blank row

#### Scope Items (`extrasRowsContainer`)

Dynamic rows, each with: Description (text), Qty (number), Cost (number), Sell (number), Remove (×)

Preset add buttons:
- `+ Footings` — qty=nPosts, cost=$85/ea
- `+ Electrical` — qty=1, cost from settings
- `+ Downlights` — qty=4, cost=$50, sell=$85
- `+ Demo` — qty=1, cost=$500
- `+ Delivery` — qty=1, cost=$200
- `+ Crane Hire` — qty=1, cost=$600
- `+ Council/Permit` — qty=1, cost=$350
- `+ Soakwell` — qty=1, cost=$800
- `+ Skip Bin` — qty=1, cost=$350
- `+ Custom` — blank row

#### Labour

- Field: `labTrades` — number, Label: Trades, Default: 2, Min: 1, Step: 1
- Field: `labDays` — number, Label: Days, Default: 1.5, Min: 0.5, Step: 0.5
- Field: `labDayRate` — number, Label: Day Rate ($/day), Default: 400, Min: 0, Step: 10
- Field: `labSellInput` — number, Label: Labour Sell price, Default: 2000, Min: 0, Step: 50

#### Hidden Legacy Fields

- Field: `noteMaterialOrder` — textarea (hidden), backward compat
- Field: `pricingNotes` — textarea (hidden), backward compat

#### Output Action Buttons

- Quote PDF → `generateQuotePDF()`
- Material Order → `generateMaterialOrder()` (sub-buttons: Copy Steel, Copy Sheets, Copy Fab, Download PDF)
- Work Order → `generateWorkOrderPDF()`
- Save Raw Data → `exportRawData()`
- Load Saved Job: `input[file]` (accept=".json")

---

## MODALS & OVERLAYS

---

### Materials Edit Modal (`materialsModal`)

- Field: `globalMarkupPct` (duplicate ID) — number, default: 35
- Field: `showCostToggle` — checkbox, "Show cost prices", default: unchecked
- Dynamic rows for addon items: editable desc, qty, cost, sell, delete
- Footer: "Add Custom Item", total display, "Done"

### Settings / Rates Modal (`ratesModal`)

#### Defaults

- Field: `settingsDefaultMarkup` — number, default: 35
- Field: `settingsDefaultDayRate` — number, default: 400
- Field: `settingsDefaultTrades` — number, default: 2
- Field: `settingsDefaultDays` — number, default: 1.5

#### Scope Item Default Costs

- Field: `settingsScopeFootings` — number, default: 85 ($/each)
- Field: `settingsScopeDemo` — number, default: 500
- Field: `settingsScopeCrane` — number, default: 600
- Field: `settingsScopePermit` — number, default: 350
- Field: `settingsScopeSoakwell` — number, default: 800
- Field: `settingsScopeSkip` — number, default: 350
- Field: `settingsScopeDelivery` — number, default: 200
- Field: `settingsScopeElectrical` — number, default: 0

#### Output Options

- Field: `settingsShowWoCosts` — checkbox, "Show cost prices on Work Order", default: unchecked
- Field: `settingsItemisedQuote` — checkbox, "Itemised quote", default: unchecked

#### Rates Table (`ratesBody`)

Dynamic editable table of $/LM, $/ea rates. "Reset to Defaults" button. Stored in localStorage.

### Box Gutter Designer Modal (`gutterDesignerModal`)

- Field: `bgHouseCatch` — number, "House Catchment (m²)", default: 30, min: 0, step: 1
- Field: `bgPatioCatch` — number (readonly), "Patio Catchment (m²)", auto-calculated
- Field: `bgRunLength` — number, "Gutter Run (mm)", default: 6000, min: 1000, max: 15000, step: 100
- Field: `bgAvailWidth` — number, "Available Width (mm)", default: 300, min: 150, max: 600, step: 10
- Field: `bgAvailDepth` — number, "Available Depth (mm)", default: 150, min: 75, max: 300, step: 10
- Field: `bgFallRatio` — select, options: 1:100, 1:80, 1:60 (default), 1:40
- Field: `bgDownpipe` — select, options: 100x75 rectangular, 100x100 square, 90mm round

Canvas: `bgCanvas` — cross-section rendering
Buttons: "Remove Gutter" / "Save to Truss"
Output: `bgResCatch`, `bgResFlow`, `bgResDP`, `bgResBack`, `bgResSoleW`, `bgResSoleD`, `bgResFront`, `bgResTurnIn`, `bgResGirth`, `bgResFB`, `bgResFall`

### Import / Load Job Modals

- Field: `importTextarea` — textarea in `importModal`
- Field: `loadJobTextarea` — textarea in `loadJobModal`, rows=6

---

## 3D VIEWPORT CONTROLS (Right Panel)

- Field: `asmSectionSelect`
  Type: select
  Options: (empty), Riser Detail, Post Detail, Gutter Detail, Ridge Detail
  Triggers: `handleAsmSectionChange()`

- Layer toggle panel: styled div items (`.layer-item`) with click handlers — not standard checkboxes

---

## HIDDEN COMPLEXITY SCORE INPUTS

Always hidden (`display:none` wrapper).

- Field: `cxBuild` — number, default: 3
- Field: `cxAccess` — number, default: 3
- Field: `cxDistance` — number, default: 2
- Field: `cxFooting` — number, default: 3
- Field: `cxHeight` — number, default: 2

---

## SUMMARY STATISTICS

| Category | Count |
|----------|-------|
| text inputs | 8 |
| number inputs | ~52 |
| hidden inputs | 10 |
| checkboxes | 14 |
| radio groups | 3 (polycarb, riserType, bracketType) |
| file input | 1 |
| select dropdowns | ~24 |
| textareas | 8 (3 visible, 5 hidden/compat) |
| toggle button groups | 6 (→ hidden inputs) |
| colour chip pickers | 2 |
| stepper controls (JS-managed) | 2 |
| **Total distinct controls** | **~130** |

---

## KEY CONDITIONAL VISIBILITY RULES

| Condition | Shown | Hidden |
|-----------|-------|--------|
| Roof = **gable** | `sec-truss`, `gableInfillField`, `gableBattenSubsection` | `rafterSubsection`, `skillionBattenSubsection` |
| Roof = **skillion/hip** | `rafterSubsection`, `skillionBattenSubsection` | `sec-truss`, `gableInfillField`, `gableBattenSubsection` |
| Roofing = **SolarSpan** | `ceilingFinishField` | `bmtField`, `polycarbField` |
| Roofing = **Trimdek/Corrugated** | `bmtField`, `polycarbField` | `ceilingFinishField` |
| Connection = **riser** | riser fields | `fasciaBracketQtyField` |
| Connection = **fascia** + gable | `fasciaBracketQtyField` | riser fields |
| Connection = **freestanding** | — | `fasciaHeightField`, `houseAttachmentSubsection` |
| Connection = **wall** | forces skillion | disables gable/hip options |
| `existingSite` ≠ clear | `demoScopeGroup` | — |
| `trussRiserOn` checked | riser inputs, type panel, box gutter btn | — |
| `trussExtOn` checked | `trussExtInputs` | — |
| Polycarb = yes | `polycarbOptions` | — |
| Polycarb pattern = custom | `polycarbCustomField` | — |
| Flyover | requires insulated + not gable | disabled otherwise |

---

## TOGGLE BUTTON GROUP MECHANISM

Handler: `setToggle(fieldId, value, btn)` — sets hidden input, toggles `.active` class, calls `updateSiteDetails()` + `updateUI()`.

Restore: `restoreToggle(fieldId, val)` — used in import/load to restore button state.

All 6 groups use `data-value` attributes on buttons.

---

## EXPORT/IMPORT FIELD LIST (from `gatherJobData()`)

**Client:** jobRef, clientName, siteAddress, clientPhone, clientEmail, salesperson, customerName, customerAddress, customerPhone

**Config:** inRoofStyle, inOrientation, inWidth, inLength, inPitch, inPostHeight, inPosts, inPostQty, inTrusses, inRafters, inRafterSize, inRafterSpacing, inRafterQtyOverride, inRoofing, inInfill, inConnection, inFasciaHeight, inRiserHeight, inRiserOffset, inRiserQty, inHouseGutter, inRiserGutter, inFasciaBracketQty, inPostFix, inPostSize, inBeamSize, inTrussBase, inTrussChord, inTrussSteel, inOverhang, trussRiserOn, riserLH, riserLV, riserRH, riserRV, trussRiserLock, riserTypeSeparate, trussExtOn, trussExtLen, sheetColor, steelColor, polycarbEnabled, inPolycarbBrand, inPolycarbTint, inPolycarbPattern, inPolycarbCustom, inPolycarbLevel, inCeilingFinish, inBMT, extraBattensVal, bracketType

**Site Details:** siteAccess, groundSurface, fasciaMaterial, wallType, existingRoof, existingGutter

**Existing Site:** existingSite, demoScope, electrical

**Pricing:** addonRows, extrasRows, additionalMaterials, labTrades, labDays, labDayRate, labSellInput

**Complexity:** cxBuild, cxAccess, cxDistance, cxFooting, cxHeight

**Notes:** jobNotes, pricingNotes, noteQuote, noteWorkOrder, noteMaterialOrder, noteInternal

**Scope:** elecDownlights, elecDownlightsQty, elecFan, elecFanQty, elecGPO, elecGPOQty, scopeDemo, scopeSkip, scopePermit

**Flashings:** Array of {id, name, colour, gauge, length, qty, colourSide, points, girth, legs, startTreatment, endTreatment}
