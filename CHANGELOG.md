# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 - 2026-09-08

First published release. The `polarTable` document structure is extracted from `signalk-polar-performance-plugin` into a standalone, Signal K independent package.

### Added

- JSON Schema (`polarTableSchema`) describing the canonical `polarTable` document.
- `validatePolarTable(data)` for schema and semantic validation of canonical documents.
- `toCanonicalPolarTable(data)` to convert a supported-unit table into a canonical SI document without mutating the input.
- `convertPolarTableUnits(data, targetUnits)` to convert between supported unit sets.
- Optional `id` field in canonical polar table metadata.
- Non-throwing result objects (`{ valid, value, errors }`) for all public helpers.