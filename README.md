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

`schemaVersion` describes the format of the document, not the version of this package. Consumers should reject a document whose major version they do not understand, and tolerate unknown minor versions of the same major version.

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

