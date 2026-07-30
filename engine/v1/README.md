# PatioModel and deterministic geometry v1

This is the isolated foundation for the patio rendering rebuild. It is a pure TypeScript module with no DOM, Three.js, persistence, pricing, network, PDF, quote, supplier, fabrication, material-order or work-order dependency.

**Nothing in the legacy app imports this directory.** `index.html` and all existing live-output paths remain authoritative and unchanged. This engine runs only when imported explicitly by a test or future shadow runner.

## Versioned contracts

- Model schema: `patio-model/v1`
- Geometry output: `patio-geometry/v1`
- Canonical linear unit: integer millimetres (`mm`)
- Angle unit: decimal degrees
- Supported footprint: rectangle
- Supported roofs: skillion, reverse skillion and gable
- Gable orientations: lengthways and projection-axis (`perpendicular` / `house-facing` legacy modes)

Hip, polygon, multi-zone, L/T/U, skew, side-skew, wraparound, cantilever, courtyard/between-structures and house-jog geometry are deliberately rejected by the legacy adapter. They are not silently treated as gable or rectangle.

## PatioModelV1 schema

`patio-model.ts` is the typed schema and runtime trust boundary. The main groups are:

| Group | Canonical content |
|---|---|
| Identity | `schemaVersion`, `scopeId`, optional `optionId`, job type |
| Footprint | rectangle length/projection, rear/end overhangs, patio-past-house dimensions |
| Roof | discriminated skillion/reverse-skillion/gable type, pitch, gable orientation/eave overhang |
| Attachment | discriminated freestanding, wall, fascia, riser or flyover details and heights |
| Structure | post height/layout/setbacks/fixing, typed sections for posts/beams/rafters/purlins/trusses, truss fabrication choices, external frame and tie beams |
| Roofing | product/profile/material, cover width, panel thickness, BMT, full/partial sheet coverage, colours, ceiling, skylights/polycarbonate choices |
| Drainage/infill/finishes | include flags, gutter choices, selected downpipe posts, infill and colours |
| Field scope | existing site, electrical/services, demolition/skip/permit choices, notes |
| Flashings | stable IDs, mm profile points/girth/length, gauge, quantity and treatments |
| Capability declaration | rectangle plus the selected launch roof capability |

`validatePatioModel()` rejects metre strings and other implicit coercion. `parsePatioModel()` returns a detached validated model. String parsing exists only in the named migration boundary `adaptLegacyScope()`.

Client contact details and commercial pricing are intentionally outside the physical PatioModel. They remain in their existing job/quote envelopes; this mission does not introduce a second quote or pricing contract.

### Structured `job_scope`

`deriveStructuredJobScope(model)` copies dimensions directly from canonical numeric fields:

```ts
const jobScope = deriveStructuredJobScope(model);
// jobScope.length_mm === model.footprint.lengthMm
// jobScope.projection_mm === model.footprint.projectionMm
```

It never parses UI metre strings. The function is pure and does not write to Supabase or any other store.

## Geometry coordinate system

All points use a fixed right-handed millimetre system:

- origin `(0, 0, 0)`: back-left corner at ground;
- `+x`: along patio length, left to right;
- `+y`: height above ground;
- `+z`: projection, from house/back toward front/gutter.

Beam height metrics are beam-bottom/post-top datums, matching the current rectangular legacy calculation. Member section depth is added to produce support-top and roof-plane coordinates.

The engine returns:

- stable key points and support/ridge heights;
- posts, perimeter/attachment beams and risers;
- skillion rafters and purlins;
- gable truss rafters, chords/webs, ridge and purlins;
- one skillion plane or two gable planes;
- deterministic sheet counts, partial width, covered range and sheet run per plane;
- dimensional metrics suitable for golden and shadow comparison.

Every member has stable ID, role, typed section, start/end coordinates and a derived true length. Derived coordinates are rounded to 0.001 mm, so `JSON.stringify(computePatioGeometry(model))` is stable for the same validated input and engine version. The engine uses no date, locale, random value, DOM state or mutable global.

## Legacy shadow harness

`shadow-comparison.ts` provides three explicit stages:

```ts
const { model, warnings } = adaptLegacyScope(legacyScope);
const geometry = computePatioGeometry(model);
const report = compareLegacyScope(legacyScope);
```

The default comparison uses a side-effect-free port of the rectangular legacy `getInputs()`, `calculateRafters()` and `calculateSheets()` dimensions/counts. A caller can inject a captured legacy computation through `legacyComputation` without changing the new engine.

A report includes both snapshots, canonical model, geometry, derived structured job scope and itemised differences (`path`, old/new value, delta and tolerance). It performs no save, telemetry or output generation.

Golden shadow evidence currently has zero differences at 0.001 mm tolerance:

| Fixture | Roof / attachment | Compared result |
|---|---|---|
| `skillion-riser-6x3` | 6000×3000, 5°, riser | parity |
| `reverse-skillion-freestanding-5x3-5` | 5000×3500, 7.5°, freestanding | parity |
| `gable-freestanding-7-2x4` | 7200×4000, 15°, lengthways gable | parity |

The tests also prove projection-axis gable parity and verify that an injected 25 mm legacy delta is reported at the exact path.

## Tests

From repository root:

```bash
npm test
# or directly:
node --test engine/v1/*.test.ts
```

`fixtures/golden-cases.json` is colocated with the engine. Tests cover runtime schema validation, canonical `job_scope` units, launch-roof geometry, all five attachment height rules, member dimensions, representative legacy parity, advanced-shape rejection and byte-identical SHA-256 output for all three goldens.

Not covered in v1: engineering/load certification, component/BOM/pricing calculations, visual rendering, persistence, offline sync, PDFs, live browser wiring, advanced-shape geometry, and exhaustive goldens for every material/attachment combination.
