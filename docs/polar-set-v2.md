# Version 2 polar sets

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

All helpers use the same non-throwing result format documented in the
[README](../README.md#helpers):

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
`flat` (only `"1"`). Wave quantities optionally accept `significantWaveHeight`
(`"m"` only), `wavePeriod` (`"s"` only), `waveAngle` (radians or degrees and their
supported aliases), and `speedFactor` (`"1"` only). `SUPPORTED_UNITS` lists all
supported quantities. Omitted heel and wave-angle units mean radians
independently of the TWA unit. Reef/flat and wave speed factors, wave heights,
wave periods, sail areas (m²) and sailplan references are unchanged; null cells
and omitted fields are preserved. Optional unit declarations already present
are retained in canonical form when not explicitly overridden.

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
- Root descriptive metadata uses the same fields as
  [version 1](../README.md#fields).

### Descriptive configurations, not operational sailplan ownership

The `sailplans` entries describe the sailing configurations to which performance
tables apply. They do not define an authoritative operational sailplan registry.
Each entry must have a table; its document-local ID supports attribution within
the polar set. Known sail names, types, areas and source IDs provide descriptive
context, not references that this library resolves against a vessel inventory.

An operational sailplan is a different abstraction: it combines inventory sails
and their reef settings. Inventory sails and operational sailplans have an N:M
relationship, with reef settings belonging to each sail's participation in a
plan. In the proposed operational model, a sailplan has zero or one associated
polar table and can exist before performance data is available. Its identity and
lifecycle should therefore not depend on creating, replacing or deleting a
polar.

There is not yet an agreed, implemented owner of that operational abstraction
in this integration. This format does not claim that another component already
provides it. A future operational sailplan owner could associate a plan with a
polar resource and the relevant document-local sailplan/table ID. Designing that
owner and association is outside this revision.

Keeping this boundary preserves portability: performance data imported from ORC
or another boat need not identify sails in the receiving vessel's inventory.
Consequently, canonical sail descriptions contain neither inventory references
nor discrete reef settings. The VPP `reefMatrix` remains numerical target data,
not an operational reef index.

Standalone sail-selection/crossover charts without performance tables, such as
TimeZero's sail chart, are outside this revision. Making tables optional would
not by itself model those charts' wind ranges and configuration states.

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
calculated by this library. Stored target VMG is a nonnegative magnitude
`tbs * abs(cos(twa))` for both beat and run, consistent with existing version-1
producers. The target's beat/run role provides the direction. Importers must
normalize signed source VMG to a magnitude. Validation rejects negative target
VMG, but does not enforce exact trigonometric equality because source values can
be rounded. This convention does not prescribe whether separate calculation
APIs return signed wind-axis velocity.

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

### Wave correction

An optional root-level `waveCorrection` describes a vessel-wide boat-speed
multiplier shared by `best` and every sailplan table. It is separate from the
wind-polar matrices because it depends on sea state, not TWS/TWA. Omitting it
means no correction model was supplied, not that waves are known to have no
effect. Do not invent a model during import or migration.

The layered representation accommodates the independent, sparse height/period
grids in the [TimeZero sample discussed in
Asw1n/signalk-polar-management#3](https://github.com/Asw1n/signalk-polar-management/issues/3).
For example:

```json
{
  "waveCorrection": {
    "heights": [
      {
        "significantWaveHeight": 0,
        "axes": {
          "wavePeriod": [1, 16],
          "waveAngle": [0, 3.141592653589793]
        },
        "values": {
          "speedFactorMatrix": [[1, 1], [1, 1]]
        }
      },
      {
        "significantWaveHeight": 2,
        "axes": {
          "wavePeriod": [1, 5, 10, 15],
          "waveAngle": [0, 3.141592653589793]
        },
        "values": {
          "speedFactorMatrix": [
            [0.9, 1],
            [0.9, 1.1],
            [0.9, 1.15],
            [0.9, 1.2]
          ]
        }
      }
    ]
  }
}
```

This is a root-property fragment, not a complete polar document; the example
abbreviates the sample's angle grids. Every height layer contains:

- `significantWaveHeight`: finite, nonnegative height in metres, not individual
  wave height. Layers are strictly increasing without duplicates.
- `axes.wavePeriod`: finite positive wave periods in seconds, strictly
  increasing. These are wave periods, not vessel encounter periods. The source
  must use a consistent period definition; this format does not imply a peak or
  mean spectral period.
- `axes.waveAngle`: finite, strictly increasing unsigned angles in `0..pi`.
  The angle is where waves come **from**, relative to the bow/heading: zero
  means head sea, `pi/2` beam sea and `pi` following sea. It is not relative to
  wind or course over ground. Port/starboard effects are assumed symmetric.
  Consumers must normalize absolute wave directions to this convention.
- `values.speedFactorMatrix`: finite nonnegative dimensionless factors,
  indexed `[wavePeriodRow][waveAngleColumn]`, with dimensions exactly matching
  that layer's axes. Zero is valid and means zero corrected speed; one is
  neutral, and values above one are allowed (following seas can increase speed).
  Unlike wind-table auxiliary fields, null/missing factor cells are not
  supported.

Height layers may have different axes; a zero-height layer and complete angular
coverage are not required. If a zero-height layer is supplied, all its factors
must be exactly one. All units are fixed SI when declarations are omitted;
optional root unit declarations make them explicit as described above.

`validatePolar` checks ordering, matrix dimensions and zero-height neutrality
as well as the schema constraints. `convertPolarUnits` and `toCanonicalPolar`
convert every layer's wave-angle axis using `units.waveAngle`, independently
of `units.twa`, preserving factors, heights and periods. Migration of a v2
document deep-copies the correction; migration from v1 leaves it absent.

Application, interpolation and target optimization belong in `polar-math`,
not this package. The intended application is:

```text
corrected speed = baseline wind-polar speed * wave speed factor * performance factor
```

For consumers, a suitable starting interpolation policy is linear in angle,
then period within each neighbouring height layer, then height. This is not a
claim about TimeZero's interpolation algorithm. Queries outside supported ranges
need explicit, reported handling; absence or out-of-range data must not silently
be treated as factor one. Partial coverage is not permission to extrapolate.

The model does not revise stored heel/reef/flat targets or baseline derived
targets. Wave-corrected VMG optima may move with heading and must be recalculated,
not merely obtained by scaling the stored beat/run targets. A sailplan-specific
override, multiple simultaneous wave systems and corrections to an already
sea-state-adjusted baseline are not defined by this revision; consumers must
avoid applying the same wave effect twice.

### Consumer rollout

Format support does not make existing consumers able to process `polarSet`.
The rollout sequence is:

1. Make this format library's version-2 schema and helpers available.
2. Add version-2 table selection and calculation support to `polar-math`.
3. Update management and dependent consumers to handle the new documents.
4. Only then enable storing/selecting version-2 documents in workflows that
   depend on those consumers.

Keep existing version-1 storage and consumption workflows during that transition.
Do not automatically migrate persisted documents merely because a migration
helper is available. Consumers must deliberately opt in once the complete path
supports version 2. Interpolation, wave-factor application and target
optimization remain calculation-library work, not format-library behaviour.
