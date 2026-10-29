'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  CANONICAL_UNITS, polarSetV2Schema, validatePolar, validatePolarTable,
  convertPolarUnits, convertPolarTableUnits, toCanonicalPolar,
  toCanonicalPolarTable, migratePolarToV2
} = require('../src')

function table() {
  return {
    axes: { tws: [3, 5], twa: [1, 2] },
    values: {
      boatSpeedMatrix: [[2, null], [3, 4]],
      heelMatrix: [[0.2, null], [null, 0.4]],
      reefMatrix: [[1.0006, null], [0.8, 1]],
      flatMatrix: [[0.9, null], [1, 1]]
    },
    derived: {
      rows: [{
        tws: 3,
        beat: { twa: 0.8, tbs: 2, vmg: 1.4, heel: 0.2, reef: 1, flat: 0.9 },
        run: { twa: 2.8, tbs: 3, vmg: -2.8, heel: 0.1 },
        maxSpeed: 3,
        maxSpeedAngle: 1.5
      }, { tws: 5, beat: null, run: null }]
    }
  }
}

function v2() {
  return {
    kind: 'polarSet',
    schemaVersion: '2.0.0',
    units: { ...CANONICAL_UNITS },
    symmetry: { portStarboardSymmetric: true },
    best: table(),
    sailplans: [{
      id: 'jib', name: 'Main + J1',
      sails: [{ name: 'J1', area: 33.01 }],
      table: table()
    }]
  }
}

function v1() {
  return {
    kind: 'polarTable', schemaVersion: '1.0.0',
    units: { ...CANONICAL_UNITS },
    symmetry: { portStarboardSymmetric: true },
    name: 'Boat', id: 'boat', notes: 'Source notes',
    axes: { tws: [3], twa: [1] },
    values: { boatSpeedMatrix: [[2]] },
    derived: { rows: [{ tws: 3, beat: { twa: 0.8, tbs: 2, vmg: 1.4 }, run: null }] }
  }
}

function success(result) {
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  return result.value
}

function near(actual, expected) {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected))
    for (const key of Object.keys(expected)) near(actual[key], expected[key])
  } else assert.equal(actual, expected)
}

describe('version-aware polar helpers', () => {
  it('exports v2 schema and validates both versions', () => {
    assert.equal(polarSetV2Schema.title, 'PolarSetV2')
    success(validatePolar(v1()))
    success(validatePolar(v2()))
  })

  it('rejects unknown versions and mismatched kinds in all entry points', () => {
    for (const data of [
      { ...v1(), schemaVersion: '2.0.0' },
      { ...v2(), schemaVersion: '1.0.0' },
      { ...v2(), schemaVersion: '2.1.0' },
      { ...v1(), schemaVersion: '1.1.0' }
    ]) {
      for (const result of [validatePolar(data), toCanonicalPolar(data), convertPolarUnits(data, CANONICAL_UNITS), migratePolarToV2(data)]) {
        assert.equal(result.valid, false)
      }
    }
    assert.equal(validatePolarTable(v2()).valid, false)
    assert.equal(convertPolarTableUnits(v2(), CANONICAL_UNITS).valid, false)
  })

  it('never throws on malformed JSON-shaped input', () => {
    for (const input of [null, [], 42, {}, { kind: 'polarTable', schemaVersion: '1.0.0' }, { ...v2(), best: null }]) {
      for (const fn of [validatePolar, toCanonicalPolar, migratePolarToV2, toCanonicalPolarTable]) {
        assert.equal(fn(input).valid, false)
      }
      assert.equal(convertPolarUnits(input, CANONICAL_UNITS).valid, false)
    }
    const data = v1()
    data.derived.rows = [null]
    assert.equal(toCanonicalPolarTable(data).valid, false)
  })

  const invalidCases = [
    ['unsorted axis', d => { d.best.axes.tws = [5, 3] }, '/best/axes/tws/1'],
    ['duplicate axis', d => { d.best.axes.twa = [1, 1] }, '/best/axes/twa/1'],
    ['speed row count', d => { d.best.values.boatSpeedMatrix.pop() }, '/best/values/boatSpeedMatrix'],
    ['heel dimensions', d => { d.sailplans[0].table.values.heelMatrix[1].pop() }, '/sailplans/0/table/values/heelMatrix/1'],
    ['reef dimensions', d => { d.best.values.reefMatrix.pop() }, '/best/values/reefMatrix'],
    ['flat dimensions', d => { d.best.values.flatMatrix[0].push(null) }, '/best/values/flatMatrix/0'],
    ['duplicate IDs', d => { d.sailplans.push(structuredClone(d.sailplans[0])) }, '/sailplans/1/id'],
    ['unknown reference', d => { d.best.sailplanIdMatrix = [['missing', null], [null, null]] }, '/best/sailplanIdMatrix/0/0'],
    ['unknown target reference', d => { d.best.derived.rows[0].beat.sailplanId = 'missing' }, '/best/derived/rows/0/beat/sailplanId'],
    ['unavailable auxiliary', d => { d.best.values.heelMatrix[0][1] = 0.3 }, '/best/values/heelMatrix/0/1'],
    ['unavailable attribution', d => { d.best.sailplanIdMatrix = [[null, 'jib'], [null, null]] }, '/best/sailplanIdMatrix/0/1'],
    ['derived TWS absent', d => { d.best.derived.rows[0].tws = 4 }, '/best/derived/rows/0/tws'],
    ['duplicate derived rows', d => { d.best.derived.rows.push(structuredClone(d.best.derived.rows[0])) }, '/best/derived/rows/2/tws']
  ]
  for (const [name, mutate, path] of invalidCases) {
    it(`rejects ${name} with a precise path`, () => {
      const data = v2()
      mutate(data)
      const result = validatePolar(data)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.path === path), JSON.stringify(result.errors))
      assert.equal(toCanonicalPolar(data).valid, false)
    })
  }

  it('rejects non-finite quantities, invalid ranges and unknown properties', () => {
    for (const value of [NaN, Infinity, -Infinity, -1]) {
      const data = v2()
      data.best.values.boatSpeedMatrix[0][0] = value
      assert.equal(validatePolar(data).valid, false)
      assert.equal(toCanonicalPolar(data).valid, false)
    }
    const data = v2()
    data.best.derived.rows[0].beat.heel = 2
    assert.equal(toCanonicalPolar(data).valid, false)
    delete data.best.derived.rows[0].beat.heel
    data.extra = true
    assert.equal(toCanonicalPolar(data).valid, false)
  })

  it('converts every table, matrix and derived field without mutation', () => {
    const data = v2()
    data.best.sailplanIdMatrix = [['jib', null], ['jib', 'jib']]
    data.best.derived.rows[0].beat.sailplanId = 'jib'
    const snapshot = structuredClone(data)
    const units = { tws: 'kn', twa: 'deg', boatSpeed: 'kn', heel: 'deg' }
    const display = success(convertPolarUnits(data, units))
    assert.deepEqual(data, snapshot)
    for (const t of [display.best, display.sailplans[0].table]) {
      near(t.axes.tws[0], 3 * 1.94384)
      near(t.axes.twa[0], 180 / Math.PI)
      near(t.values.boatSpeedMatrix[0][0], 2 * 1.94384)
      near(t.values.heelMatrix[0][0], 0.2 * 180 / Math.PI)
      near(t.derived.rows[0].beat.heel, 0.2 * 180 / Math.PI)
      near(t.derived.rows[0].run.vmg, -2.8 * 1.94384)
      near(t.derived.rows[0].maxSpeed, 3 * 1.94384)
      near(t.derived.rows[0].maxSpeedAngle, 1.5 * 180 / Math.PI)
      assert.equal(t.values.boatSpeedMatrix[0][1], null)
      assert.equal(t.values.heelMatrix[1][0], null)
      assert.equal(t.values.reefMatrix[0][0], 1.0006)
    }
    assert.deepEqual(display.best.sailplanIdMatrix, data.best.sailplanIdMatrix)
    assert.equal(display.sailplans[0].sails[0].area, 33.01)
    const canonical = success(toCanonicalPolar(display))
    delete canonical.units.heel
    near(canonical, data)
    display.sailplans[0].sails[0].name = 'Changed'
    assert.equal(data.sailplans[0].sails[0].name, 'J1')
  })

  it('defaults heel to radians independently of TWA units', () => {
    const data = success(convertPolarUnits(v2(), { tws: 'kn', twa: 'deg', boatSpeed: 'kn' }))
    assert.equal(data.units.heel, undefined)
    assert.equal(data.best.values.heelMatrix[0][0], 0.2)
    near(success(toCanonicalPolar(data)).best.values.heelMatrix[0][0], 0.2)
  })

  it('preserves omitted fields, independent grids and optional unit declarations', () => {
    const data = v2()
    data.units.reef = '1'
    data.units.flat = '1'
    data.best = { axes: { tws: [4], twa: [1.2] }, values: { boatSpeedMatrix: [[2]] } }
    const result = success(toCanonicalPolar(data))
    assert.deepEqual(result, data)
    assert.equal(result.best.values.heelMatrix, undefined)
  })

  it('rejects invalid target units without throwing', () => {
    for (const units of [null, [], {}, { ...CANONICAL_UNITS, heel: 'grads' }, { ...CANONICAL_UNITS, reef: '%' }, { ...CANONICAL_UNITS, extra: 'kn' }]) {
      assert.equal(convertPolarUnits(v2(), units).valid, false)
    }
  })

  it('checks source angle limits after unit conversion', () => {
    const units = { tws: 'kn', twa: 'deg', boatSpeed: 'kn', heel: 'deg' }
    for (const mutate of [
      d => { d.best.axes.twa[1] = 181 },
      d => { d.best.values.heelMatrix[0][0] = 91 },
      d => { d.best.derived.rows[0].beat.heel = 91 },
      d => { d.best.derived.rows[0].run.twa = 181 },
      d => { d.best.derived.rows[0].maxSpeedAngle = 181 }
    ]) {
      const data = success(convertPolarUnits(v2(), units))
      mutate(data)
      assert.equal(toCanonicalPolar(data).valid, false)
    }
    const data = success(convertPolarUnits(v1(), { tws: 'kn', twa: 'deg', boatSpeed: 'kn' }))
    data.derived.rows[0].beat.twa = 181
    assert.equal(toCanonicalPolarTable(data).valid, false)
  })

  it('rejects unsupported source heel and factor units', () => {
    for (const units of [{ heel: 'grads' }, { reef: '%' }, { flat: '%' }]) {
      const data = v2()
      Object.assign(data.units, units)
      assert.equal(toCanonicalPolar(data).valid, false)
    }
  })

  it('validates missing attribution as unknown and resolves known references', () => {
    const data = v2()
    data.best.sailplanIdMatrix = [['jib', null], [null, 'jib']]
    data.best.derived.rows[0].run.sailplanId = 'jib'
    success(validatePolar(data))
    data.sailplans = []
    assert.equal(validatePolar(data).valid, false)
  })

  it('rejects overflow instead of returning non-finite output', () => {
    const data = v1()
    data.values.boatSpeedMatrix[0][0] = Number.MAX_VALUE
    assert.equal(convertPolarUnits(data, { ...CANONICAL_UNITS, boatSpeed: 'kn' }).valid, false)
  })

  it('migrates v1 without inventing data and clones v2 on repeated migration', () => {
    const input = v1()
    const snapshot = structuredClone(input)
    const result = success(migratePolarToV2(input))
    assert.equal(result.kind, 'polarSet')
    assert.equal(result.schemaVersion, '2.0.0')
    assert.deepEqual(result.best, { axes: input.axes, values: input.values, derived: input.derived })
    for (const key of ['name', 'id', 'notes', 'units', 'symmetry']) assert.deepEqual(result[key], input[key])
    assert.equal(result.sailplans, undefined)
    assert.deepEqual(input, snapshot)
    result.best.values.boatSpeedMatrix[0][0] = 9
    assert.deepEqual(input, snapshot)
    const again = success(migratePolarToV2(result))
    assert.deepEqual(again, result)
    assert.notEqual(again.best, result.best)
  })

  it('keeps canonicalization version-preserving for v1 and v2', () => {
    for (const data of [v1(), v2()]) {
      const display = success(convertPolarUnits(data, { tws: 'kn', twa: 'deg', boatSpeed: 'kn' }))
      const result = success(toCanonicalPolar(display))
      assert.equal(result.schemaVersion, data.schemaVersion)
      near(result, data)
    }
  })
})
