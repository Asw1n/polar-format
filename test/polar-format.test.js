'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  CANONICAL_UNITS,
  SUPPORTED_UNITS,
  polarTableSchema,
  validatePolarTable,
  toCanonicalPolarTable,
  convertPolarTableUnits
} = require('../src')

const KNOT_TO_MPS = 1 / 1.94384
const DEG_TO_RAD = Math.PI / 180

function validPolar(overrides = {}) {
  return {
    kind: 'polarTable',
    schemaVersion: '1.0.0',
    name: 'Example Boat',
    units: { ...CANONICAL_UNITS },
    symmetry: { portStarboardSymmetric: true },
    axes: {
      tws: [3, 5],
      twa: [45 * DEG_TO_RAD, 90 * DEG_TO_RAD, 150 * DEG_TO_RAD]
    },
    values: {
      boatSpeedMatrix: [
        [2.1, 2.4, 2.0],
        [3.1, 3.4, 2.8]
      ]
    },
    derived: {
      rows: [
        {
          tws: 3,
          beat: { twa: 45 * DEG_TO_RAD, tbs: 2.1, vmg: 1.48 },
          run: null,
          maxSpeed: 2.4,
          maxSpeedAngle: 90 * DEG_TO_RAD
        }
      ]
    },
    ...overrides
  }
}

describe('polar-format', () => {
  it('exports the canonical schema and supported units', () => {
    assert.equal(polarTableSchema.title, 'PolarTable')
    assert.deepEqual(CANONICAL_UNITS, { tws: 'm/s', twa: 'rad', boatSpeed: 'm/s' })
    assert.ok(SUPPORTED_UNITS.tws.includes('kn'))
    assert.ok(SUPPORTED_UNITS.twa.includes('deg'))
  })

  it('validates a canonical SI polar table', () => {
    const result = validatePolarTable(validPolar())
    assert.equal(result.valid, true)
    assert.equal(result.value.kind, 'polarTable')
    assert.deepEqual(result.errors, [])
  })

  it('accepts an optional text id', () => {
    const result = validatePolarTable(validPolar({ id: 'ned3654' }))
    assert.equal(result.valid, true)
    assert.equal(result.value.id, 'ned3654')
  })

  it('rejects a non-text id', () => {
    const result = validatePolarTable(validPolar({ id: 3654 }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(item => item.path === '/id'))
  })

  it('returns errors instead of throwing for invalid canonical units', () => {
    const result = validatePolarTable(validPolar({
      units: { tws: 'kn', twa: 'deg', boatSpeed: 'kn' }
    }))

    assert.equal(result.valid, false)
    assert.equal(result.value, undefined)
    assert.ok(result.errors.some(item => item.path === '/units/tws'))
  })

  it('requires major.minor.patch schema versions', () => {
    const result = validatePolarTable(validPolar({ schemaVersion: '1.0' }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(item => item.path === '/schemaVersion'))
  })

  it('rejects unsorted axes', () => {
    const result = validatePolarTable(validPolar({
      axes: { tws: [5, 3], twa: [45 * DEG_TO_RAD, 90 * DEG_TO_RAD] },
      values: { boatSpeedMatrix: [[3.1, 3.4], [2.1, 2.4]] }
    }))

    assert.equal(result.valid, false)
    assert.ok(result.errors.some(item => item.path === '/axes/tws/1'))
  })

  it('rejects matrix rows that do not match the TWA axis length', () => {
    const result = validatePolarTable(validPolar({
      values: { boatSpeedMatrix: [[2.1], [3.1, 3.4, 2.8]] }
    }))

    assert.equal(result.valid, false)
    assert.ok(result.errors.some(item => item.path === '/values/boatSpeedMatrix/0'))
  })

  it('converts a single-unit-per-quantity input polar to canonical SI', () => {
    const input = validPolar({
      units: { tws: 'kn', twa: 'deg', boatSpeed: 'kn' },
      axes: { tws: [6, 10], twa: [45, 90, 150] },
      values: { boatSpeedMatrix: [[4, 5, 4.5], [6, 7, 6.5]] },
      derived: {
        rows: [{
          tws: 6,
          beat: { twa: 45, tbs: 4, vmg: 2.8 },
          run: { twa: 150, tbs: 4.5, vmg: 3.9 },
          maxSpeed: 5,
          maxSpeedAngle: 90
        }]
      }
    })

    const result = toCanonicalPolarTable(input)
    assert.equal(result.valid, true)
    assert.deepEqual(result.value.units, CANONICAL_UNITS)
    assert.equal(result.value.axes.tws[0], 6 * KNOT_TO_MPS)
    assert.equal(result.value.axes.twa[1], 90 * DEG_TO_RAD)
    assert.equal(result.value.values.boatSpeedMatrix[0][1], 5 * KNOT_TO_MPS)
    assert.equal(result.value.derived.rows[0].beat.twa, 45 * DEG_TO_RAD)
    assert.equal(result.value.derived.rows[0].beat.tbs, 4 * KNOT_TO_MPS)
  })

  it('does not mutate the input while converting', () => {
    const input = validPolar({
      units: { tws: 'kn', twa: 'deg', boatSpeed: 'kn' },
      axes: { tws: [6, 10], twa: [45, 90, 150] },
      values: { boatSpeedMatrix: [[4, 5, 4.5], [6, 7, 6.5]] }
    })

    const result = toCanonicalPolarTable(input)
    assert.equal(result.valid, true)
    assert.deepEqual(input.units, { tws: 'kn', twa: 'deg', boatSpeed: 'kn' })
    assert.equal(input.axes.tws[0], 6)
    assert.equal(input.values.boatSpeedMatrix[0][0], 4)
  })

  it('converts canonical data to supported display units', () => {
    const result = convertPolarTableUnits(validPolar(), { tws: 'kn', twa: 'deg', boatSpeed: 'kn' })
    assert.equal(result.valid, true)
    assert.deepEqual(result.value.units, { tws: 'kn', twa: 'deg', boatSpeed: 'kn' })
    assert.ok(Math.abs(result.value.axes.tws[0] - (3 / KNOT_TO_MPS)) < 1e-12)
    assert.equal(result.value.axes.twa[0], 45)
  })

  it('returns errors for unsupported source units', () => {
    const result = toCanonicalPolarTable(validPolar({
      units: { tws: 'mph', twa: 'deg', boatSpeed: 'kn' }
    }))

    assert.equal(result.valid, false)
    assert.ok(result.errors.some(item => item.path === '/units/tws'))
  })
})