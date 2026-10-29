# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Optional vessel-wide `waveCorrection` in version-2 documents, with independent
  period/angle grids per significant wave height and speed factors above one.
  Helpers validate wave grids and calm-water neutrality, convert wave angles
  independently of wind angles, and preserve the model during v2 migration.
- Wave-correction schema and helper tests covering TimeZero-style sparse layers,
  invalid data, unit conversion, round trips and non-mutation.
- Separately exported `polar-set-v2.schema.json` for version-2 polar sets:
  a required best-performance envelope, optional sailplan tables, optional heel
  and trim matrices, per-table derived targets, and explicit unavailable cells.
- Version-aware `validatePolar`, `toCanonicalPolar`, `convertPolarUnits` and
  explicit `migratePolarToV2` helpers, including version-2 cross-field validation,
  heel conversion, null preservation and non-mutating conversion/migration.
- Version-2 schema and helper tests, documentation and exported
  `polarSetV2Schema`. `SUPPORTED_UNITS` now includes heel, reef and flat.

### Changed

- Detailed version-2 reference moved to `docs/polar-set-v2.md`, including the
  boundary between descriptive polar configurations and operational sailplans,
  crossover-chart scope and staged consumer rollout guidance.
- Helpers now reject unsupported document versions and kind/version mismatches.
  Existing version-1 API names and schema remain available.

### Fixed

- Version-2 target VMG now uses nonnegative magnitudes for both beat and run,
  matching existing version-1 producers and preserving meaning during migration.
- Table unit conversion validates structure before traversal, reports malformed
  derived data rather than throwing, and rejects non-finite conversion output.

## 1.0.0 - 2026-09-08

First published release. The `polarTable` document structure is extracted from `signalk-polar-performance-plugin` into a standalone, Signal K independent package.

### Added

- JSON Schema (`polarTableSchema`) describing the canonical `polarTable` document.
- `validatePolarTable(data)` for schema and semantic validation of canonical documents.
- `toCanonicalPolarTable(data)` to convert a supported-unit table into a canonical SI document without mutating the input.
- `convertPolarTableUnits(data, targetUnits)` to convert between supported unit sets.
- Optional `id` field in canonical polar table metadata.
- Non-throwing result objects (`{ valid, value, errors }`) for all public helpers.