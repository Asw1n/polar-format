# polar-format

A canonical JSON format for sailing boat polar tables, plus validation and unit conversion helpers.

The format is deliberately generic. It describes boat performance data and nothing else: no storage ids, file paths, transport wrappers, or application specific fields. Any tool that reads, writes, or exchanges polar data can adopt it.

## What is a polar?

A *polar* describes how fast a sailing boat is expected to go in a given wind condition. It maps two inputs to one output:

- **TWS** — true wind speed
- **TWA** — true wind angle, the angle between the boat's heading and the direction the wind comes from (0 = straight into the wind, π = dead downwind)
- **boat speed** — the steady-state speed through the water the boat can achieve at that TWS and TWA

Drawn as a diagram with TWA as the angle and boat speed as the radius, one curve per wind speed, the result is the familiar polar plot — hence the name.

A few properties follow from how sailing boats behave, and the format encodes them directly:

- A boat cannot sail straight into the wind, so speeds at small TWA are zero or simply absent from the table.
- Performance is (assumed to be) mirror symmetric: sailing at 60° with the wind on the port side is the same as 60° on starboard. Only one half, TWA `0..π`, is stored.
- To make progress upwind or downwind a boat must sail at an angle to the wind. The best angle is the one that maximises **VMG**, the component of boat speed towards the wind (*beat*) or away from it (*run*). These optima can be stored alongside the table.

A polar *table* stores this relationship as a grid: one row per TWS value, one column per TWA value, and the boat speed in each cell. Values in between are obtained by interpolation, which is outside the scope of this package.

## The canonical document

A canonical polar table is a single self-describing JSON object. The format is defined by seven rules:

1. **One unit per quantity, SI only.** Speeds are m/s, angles are rad. There is no per-value or per-axis unit.
2. **Axes are strictly increasing.** No duplicates, no unsorted input.
3. **The matrix follows the axes.** `values.boatSpeedMatrix` is indexed `[twsRow][twaColumn]`; its dimensions must match the axis lengths exactly.
4. **Port/starboard symmetry is mandatory.** `axes.twa` covers `0..π` only; the other side is the mirror image.
5. **The document is self-identifying.** `kind` and `schemaVersion` are always present, so a consumer can recognise and version-check a document without external context.
6. **Metadata is optional and descriptive only.** It never affects interpretation of the numbers.
7. **Derived values are optional and redundant.** Anything in `derived` can be recomputed from the table; it is stored only to avoid repeated computation.

### Fields

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `kind` | yes | `"polarTable"` | document discriminator |
| `schemaVersion` | yes | string | `major.minor.patch` |
| `units` | yes | object | must be `{ "tws": "m/s", "twa": "rad", "boatSpeed": "m/s" }` |
| `symmetry.portStarboardSymmetric` | yes | `true` | only symmetric tables are canonical |
| `axes.tws` | yes | `number[]` | strictly increasing, each `> 0`, in m/s |
| `axes.twa` | yes | `number[]` | strictly increasing, within `0..π`, in rad |
| `values.boatSpeedMatrix` | yes | `number[][]` | `[twsRow][twaColumn]`, each `>= 0`, in m/s |
| `id`, `name`, `sailnumber`, `boatType`, `source`, `notes` | no | string | descriptive metadata |
| `year` | no | integer | descriptive metadata |
| `derived.rows` | no | array | precomputed targets, one entry per TWS |

A `derived.rows` entry holds `tws`, an optional `beat` and `run` target (each `{ twa, tbs, vmg }`, or `null` when no target exists at that wind speed), and an optional `maxSpeed` with its `maxSpeedAngle`. `tbs` is the target boat speed at that angle.

No other properties are allowed anywhere in the document.

### Example

```json
{
  "kind": "polarTable",
  "schemaVersion": "1.0.0",
  "name": "Example 36",
  "units": {
    "tws": "m/s",
    "twa": "rad",
    "boatSpeed": "m/s"
  },
  "symmetry": {
    "portStarboardSymmetric": true
  },
  "axes": {
    "tws": [3.0864, 5.144],
    "twa": [0.785398, 1.570796, 2.617994]
  },
  "values": {
    "boatSpeedMatrix": [
      [2.0578, 2.5722, 2.315],
      [3.0864, 3.6008, 3.3439]
    ]
  },
  "derived": {
    "rows": [
      {
        "tws": 3.0864,
        "beat": { "twa": 0.785398, "tbs": 2.0578, "vmg": 1.4551 },
        "run": { "twa": 2.617994, "tbs": 2.315, "vmg": 2.0043 },
        "maxSpeed": 2.5722,
        "maxSpeedAngle": 1.570796
      }
    ]
  }
}
```

### Versioning

`schemaVersion` describes the format of the document, not the version of this
package. The helpers explicitly support `1.0.0` and `2.0.0`; unsupported versions
and mismatched kind/version pairs return errors. The version-1 JSON Schema itself
only checks version-string syntax, so use the helpers for version support checks.
Unknown minor versions are not automatically accepted: strict property
validation requires explicit support for new fields.

### Units on input

Canonical documents are SI. When *converting* a document, the following source and target units are recognised:

| Quantity | Canonical | Also accepted |
| --- | --- | --- |
| `tws` | `m/s` | `kn`, `kt`, `kts`, `knot`, `knots` |
| `twa` | `rad` | `deg`, `degree`, `degrees` |
| `boatSpeed` | `m/s` | `kn`, `kt`, `kts`, `knot`, `knots` |

The single-unit-per-quantity rule always holds: a converted document is still one consistent unit set, never a mixture.

## Scope

This package defines and checks the format. Interpolation, VMG and target computation, storage, transport, import parsing of vendor polar files, and application specific selection logic are all intentionally outside it.

## Helpers

The supporting API is small. All helpers return a result object and never throw for invalid input:

```js
{ valid: true, value, errors: [] }
{ valid: false, value: undefined, errors: [{ path, message, keyword }] }
```

`path` is a JSON Pointer into the input document, so errors can be reported against the offending field.

```js
const {
  polarTableSchema,
  validatePolarTable,
  toCanonicalPolarTable,
  convertPolarTableUnits
} = require('polar-format')
```

- `polarTableSchema` — the JSON Schema for the canonical document. Also available directly as `polar-format/schema/polar-table.schema.json`, for use with any JSON Schema validator.
- `validatePolarTable(data)` — checks a canonical document against the schema and the semantic rules above.
- `toCanonicalPolarTable(data)` — converts a structurally valid table in any accepted units into a canonical SI document, then validates it. The input is not mutated.
- `convertPolarTableUnits(data, targetUnits)` — converts a table into another accepted unit set, for example for display. `derived.rows` are converted along with the axes and matrix.

```js
const result = toCanonicalPolarTable({
  kind: 'polarTable',
  schemaVersion: '1.0.0',
  units: { tws: 'kn', twa: 'deg', boatSpeed: 'kn' },
  symmetry: { portStarboardSymmetric: true },
  axes: { tws: [6, 10], twa: [45, 90, 150] },
  values: { boatSpeedMatrix: [[4, 5, 4.5], [6, 7, 6.5]] }
})

if (!result.valid) console.error(result.errors)
```

## Version 2 schema

The version-2 document schema is available alongside the unchanged version-1
schema:

```js
const polarSetV2Schema = require('polar-format/schema/polar-set-v2.schema.json')
```

The existing table-specific helpers remain version-1-only. New document-level
helpers support both versions, with structural and semantic validation:

```js
const {
  polarSetV2Schema,
  validatePolar,
  toCanonicalPolar,
  convertPolarUnits,
  migratePolarToV2
} = require('polar-format')
```

All helpers use the same non-throwing result format documented above:

- `validatePolar(data)` validates canonical SI documents without modifying them.
- `toCanonicalPolar(data)` accepts supported input units, converts to SI and
  validates, preserving the document's schema version.
- `convertPolarUnits(data, targetUnits)` accepts supported source units, validates
  the document in SI, then converts every table and its derived values to the
  requested display units. Display documents are not canonical until converted
  back to SI.
- `migratePolarToV2(data)` validates canonical input and wraps a version-1 table
  as version-2 `best`, preserving metadata and derived values without inventing
  sailplans or auxiliary data. Version-2 input is validated and deep-cloned.
  Migration does not convert display units; canonicalize those first. If an old
  document violates version-2 semantic rules, migration returns errors instead
  of silently dropping or repairing data. Downgrading is not supported.

Conversion and migration return independent deep copies. `validatePolar` returns
the original document on success, without changing it. Invalid structure is
reported before traversal; unsupported versions, units and conversion overflow
return explicit errors.

For version 2, `targetUnits` accepts required `tws`, `twa`, `boatSpeed`, optional
`heel` (radians or degrees and their supported aliases), and optional `reef` and
`flat` (only `"1"`). `SUPPORTED_UNITS` lists all supported quantities. Omitted
heel units mean radians independently of the TWA unit. Reef/flat factors, sail
areas (m²) and sailplan references are unchanged; null cells and omitted fields
are preserved. Optional unit declarations already present are retained in
canonical form when not explicitly overridden.

The raw schema can also be used with a draft-07 JSON Schema validator for
structural validation; this alone does not establish full canonical validity.

### Document structure

Version 2 has `kind: "polarSet"` and `schemaVersion: "2.0.0"`. One version,
canonical SI unit set and port/starboard symmetry declaration at the root apply
to every embedded table. This schema accepts exactly `2.0.0`; later revisions
require explicit support rather than merely changing the version string.

- `best` is a required table describing the best-performance envelope. It may
  be source-supplied or calculated; it is not a physical sailplan.
- `sailplans` is an optional array of fixed sail combinations, each with a
  document-local `id`, a descriptive `name` and its own `table`. An optional
  `sails` array records known sails by `name`, optional `type`, source identifier
  (`sourceId`) and `area` in square metres. An incomplete source inventory need
  not invent the other sails in a combination.
- Root descriptive metadata uses the same fields as version 1.

Each table has its own `axes`, `values` and optional `derived.rows`. Tables need
not share a grid. `values.boatSpeedMatrix` remains required; optional
`heelMatrix`, `reefMatrix` and `flatMatrix` use the same `[twsRow][twaColumn]`
indexing. Heel is an unsigned magnitude in radians, within `0..pi/2`. Reef and
flat are nonnegative dimensionless model factors, not discrete reef numbers or
physical control settings. No factor upper bound or automatic clamping is
specified: ORC source factors can be slightly greater than one.

At each fixed TWS/TWA, the matrices describe a single maximum-boat-speed sailing
solution for that sailplan (or the winning sailplan in `best`). For VPP data,
heel, reef and flat are the property values calculated by the VPP program at
that solution. They can be used as targets to aim for to achieve the predicted
boat speed; they are not independently maximized or minimized. "Maximum speed"
here is at the given wind angle, not the fastest angle across the polar or the
angle of maximum VMG.

All quantities have fixed canonical units. Optional root unit declarations
`heel: "rad"`, `reef: "1"` and `flat: "1"` can make these explicit; omitting
them does not change interpretation.

An omitted auxiliary matrix means that quantity is unknown throughout the
table. A `null` auxiliary cell means unknown at that condition; a `null` speed
means the sailing solution is unavailable. Zero speed is a numeric value, not
an unavailable-data sentinel. Importers must resolve vendor sentinels explicitly.
Unavailable regions must not be blindly bridged by interpolation.

Every table, including `best`, may store its own beat/run targets and maximum
speed/angle using the version-1 field names. Beat/run targets additionally
support optional `heel`, `reef` and `flat`. Here, "derived" means derivable from
a complete polar, not necessarily reconstructible from the stored grid or
calculated by this library. VMG uses the signed convention `tbs * cos(twa)`,
negative downwind; importers must normalize source magnitudes.

Only `best` may contain an optional `sailplanIdMatrix` at table level and
`sailplanId` on beat/run targets. These identify known winning sailplans.
Unknown/unavailable matrix references are `null`; unknown target references
are omitted.

### Example

```json
{
  "kind": "polarSet",
  "schemaVersion": "2.0.0",
  "name": "Example boat",
  "units": { "tws": "m/s", "twa": "rad", "boatSpeed": "m/s" },
  "symmetry": { "portStarboardSymmetric": true },
  "best": {
    "axes": { "tws": [5], "twa": [1, 2] },
    "values": {
      "boatSpeedMatrix": [[3.3, 3.1]],
      "heelMatrix": [[0.25, null]],
      "reefMatrix": [[1, 1]],
      "flatMatrix": [[0.95, 1]]
    }
  },
  "sailplans": []
}
```

### Semantic rules beyond JSON Schema

As with version 1, draft-07 cannot enforce all cross-field rules. The
`validatePolar` helper additionally checks:

- Strictly increasing axes and matrix dimensions matching each table's axes.
- Unique sailplan IDs and resolution of every non-null sailplan reference.
- Null auxiliary/reference cells wherever boat speed is unavailable.
- Derived rows referring to their table's TWS axis without duplicate rows.
- Finite numeric values (also enforced by the helpers' strict schema validator).

Importers and calculators must ensure auxiliary values and attribution belong
to the same sailing solution as boat speed, including at targets. Validation
cannot establish this physical relationship from the stored data alone, and
does not recompute source-supplied targets or test whether an envelope really is
optimal.

When calculating `best`, compare eligible, available sailplans at the requested
condition and take the winning solution's auxiliary values, leaving missing
quantities unknown. Interpolating a grid of sampled maxima is not generally
identical to taking the maximum of interpolated sailplan curves. Do not silently
replace a source-supplied envelope with a calculated one.

No apparent-wind matrices are defined in this revision: conventional horizontal
apparent wind can be calculated, while source-specific heel-projected values
would require an explicit reference-frame contract.

## Installation

```bash
npm install polar-format
```

Requires Node.js 20 or newer. The package is CommonJS and has no runtime dependencies beyond a JSON Schema validator.

## Development

```bash
npm install
npm test
```

## License

Apache-2.0. See [LICENSE](LICENSE).
