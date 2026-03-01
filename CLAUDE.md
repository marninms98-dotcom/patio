# PATIO SCOPING TOOL — PROJECT CONTEXT

## What This Is

A single-file web app used by SecureWorks WA scopers to design and quote insulated patios on-site (iPad) and by office staff to review and generate material orders. Built as vanilla HTML/CSS/JS — no frameworks, no build step.

**Open `index.html` in a browser to run it. That's the entire app.**

---

## Business Context

**Company:** SecureWorks WA Pty Ltd — outdoor living construction (Perth, Western Australia)
**Primary service:** Insulated patios using SolarSpan panels by Bondor
**Who uses this tool:**
- **Scopers** (on-site, iPad): Fill in job details, design the patio, capture photos, generate quotes
- **Office staff** (desktop): Review scoped jobs, verify material orders, send supplier orders

---

## Brand Rules (Must Follow)

| Colour | Hex | Use |
|--------|-----|-----|
| SecureWorks Orange | `#F15A29` | CTAs, accents, buttons |
| Dark Dusty Blue | `#293C46` | Headings, dark backgrounds |
| Mid Dusty Blue | `#4C6A7C` | Secondary text, borders |
| White | `#FFFFFF` | Backgrounds |

- **No pure black** for headings — use Dark Dusty Blue
- **No orange as large background** — accent only
- **Font stack:** `'Helvetica Neue', Helvetica, Arial, sans-serif`
- CSS variables are defined at top of file: `--sw-orange`, `--sw-blue-dark`, `--sw-blue-mid`, `--sw-text`, `--sw-text-sec`, `--sw-border`, `--sw-bg`

---

## File Structure

```
patio/
├── index.html       ← THE ENTIRE APP (~19,000+ lines)
├── CLAUDE.md        ← This file (project context for AI)
├── FIELD_AUDIT.md
├── SecureWorks_PDF_Brand_Template_Spec.md
└── SecureWorks_PDF_Fix_List.md
```

Everything is in `index.html`. Do NOT split into multiple files unless explicitly asked.

---

## Architecture Overview

The app has two panels:
- **Left panel**: Form inputs (job details, patio config, pricing, extras)
- **Right panel**: Live 2D/3D preview + output cards

### Key Global Objects & Functions

| Name | ~Line | Purpose |
|------|-------|---------|
| `calc` | ~4350 | Central calculation object — roof style, dimensions, posts, beams, rafters, sheets, steel sizes. Updated reactively when inputs change. |
| `gatherJobData()` | ~14357 | Collects all form data into a structured object `{ client, config, existingSite, pricing, scope, flashings }` |
| `buildSupplierRows()` | ~16257 | Returns `{ steel: [], sheets: [], fabrication: [] }` — each row is an array `[desc, size, lengthM, qty, colour, note]` |
| `calculateSheets()` | ~3957 | Returns `{ totalSheets, coverWidth, orderQuantity, ... }` |
| `calculateRafters()` | ~3334 | Returns `{ rafterCount, spacing, isOverride }` |
| `generateQuotePDF()` | ~15500 | Generates client-facing quote PDF |
| `generateMaterialOrder()` | ~16400 | Shows material order output |
| `generateWorkOrderPDF()` | ~17200 | Generates installer work order |
| `executeSaveScope()` | ~18470 | Saves job to IndexedDB |
| `showToast(msg, type)` | ~17984 | Toast notification helper |

### QA Verification System (`patioQA` object, ~line 19130)

Two-checkpoint quality system added to prevent scoping mistakes flowing through to orders:

1. **Scope verification** (scoper, on-site): 8 traffic-light cards checking job details, structure, colours, sheets, flashings, pricing. Must sign off before quotes unlock.
2. **Material review** (office person): 4 cards checking steel, sheets, gutters, fixings. Must approve before material order + work order unlock.

Key methods:
- `patioQA.showScopeVerification()` — opens scope check overlay
- `patioQA.showMaterialReview()` — opens material review overlay
- `patioQA.runScopeChecks()` — returns array of `{id, card, severity, message, field}` flags
- `patioQA.runMaterialChecks()` — material-focused check array
- `patioQA._updateButtonStates()` — gates buttons based on verification state

### Data Flow

```
User inputs → calc object updates → preview renders
                                  → gatherJobData() collects everything
                                  → buildSupplierRows() formats for orders
                                  → patioQA.runScopeChecks() validates
```

### Important Arrays/Objects

- `flashingProfiles` (~line 11864): Array of `{ id, name, colour, gauge, length, qty, girth, legs }`
- `sitePhotos` (~line 18096): Array of `{ id, file, dataUrl, label, caption }`
- `sheetColor`, `steelColor`, `flashingColor` (~line 3367): `{ name, hex }` from COLORS array
- `SHEET_SPANS` (~line 3189): `{ solarspan75: { maxSpan, minPitch, battensRequired, label } }`
- `STEEL` (~line 3100): Steel size lookup tables

---

## Technical Constraints

- **iPad Safari is the primary device** — all touch targets must be ≥44px
- **Works offline** — data saves to IndexedDB/localStorage
- **External dependencies loaded via CDN**: jsPDF, html2canvas
- **Supabase integration** loaded separately for cloud save (not in this file)
- **Single file approach** — keep it that way for simplicity
- **Test on mobile/tablet** — most field use is on iPad

---

## Common Tasks

### Adding a new field to the form
1. Add HTML input in the left panel
2. Wire it into `calc` object updates
3. Include it in `gatherJobData()` return
4. Add it to relevant QA check card in `patioQA.runScopeChecks()`

### Changing pricing/rates
- Look for `updatePricing()` and the pricing card section
- Material costs, labour rates, and margin calculations are in that area

### Modifying PDF output
- Quote PDF: `generateQuotePDF()` ~line 15500
- Material order: `buildSupplierRows()` ~line 16257 + `generateMaterialOrder()`
- Work order: `generateWorkOrderPDF()` ~line 17200

### Adding a QA check rule
- Scope checks: Add to `patioQA.runScopeChecks()` — push a `{id, card, severity, message, field}` object
- Material checks: Add to `patioQA.runMaterialChecks()`
- Severities: `red` (blocks sign-off), `amber` (needs acknowledgment), `blue` (info only)

---

## Git Workflow

```bash
# Always pull before starting work
git pull origin main

# After making changes
git add index.html
git commit -m "Description of changes"
git push origin main
```

Or just ask Claude Code to commit and push for you.

---

## Owner

**Marnin Stobbe** — SecureWorks WA founder
- GitHub: marninms98-dotcom
- This tool is for internal use only
