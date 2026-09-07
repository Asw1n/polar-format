# polar-format

Canonical polar table validation and unit conversion for Signal K polar tools.

This package defines the `polarTable` JSON structure extracted from `signalk-polar-performance-plugin`. It has no Signal K runtime dependency and performs no polar math, storage, HTTP, import parsing, or active-polar selection.

## API

```js
const {
  polarTableSchema,
  validatePolarTable,
  toCanonicalPolarTable,
  convertPolarTableUnits
} = require('polar-format')
```

`validatePolarTable(data)` validates canonical stored documents only. Canonical documents use one unit per quantity and must use SI units:

```json
{
  "tws": "m/s",
  "twa": "rad",
  "boatSpeed": "m/s"
}
```

All public helpers return result objects and do not throw for invalid input:

```js
{ valid: true, value, errors: [] }
{ valid: false, value: undefined, errors: [{ path, message, keyword }] }
```

`toCanonicalPolarTable(data)` accepts a structurally valid polar table using supported units and returns a new canonical SI object. It does not mutate the input.

Supported speed units are `m/s`, `kn`, `kt`, `kts`, `knot`, and `knots`. Supported angle units are `rad`, `deg`, `degree`, and `degrees`.

`convertPolarTableUnits(data, targetUnits)` converts between supported unit sets while preserving the single-unit-per-quantity rule.

## Canonical Shape

The canonical document body contains:

- `kind: "polarTable"`
- `schemaVersion` using `major.minor.patch`
- `units`
- `symmetry.portStarboardSymmetric: true`
- sorted `axes.tws` and `axes.twa`
- `values.boatSpeedMatrix`, indexed `[twsRow][twaColumn]`
- optional metadata: `name`, `sailnumber`, `boatType`, `year`, `source`, `notes`
- optional `derived.rows`

## Example

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
  }
}
```

Resource ids, Signal K paths, HTTP wrappers, import endpoint payloads, interpolation, VMG, and active-polar selection are intentionally outside this package.

