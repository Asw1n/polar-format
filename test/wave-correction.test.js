'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const Ajv = require('ajv')
const {
  CANONICAL_UNITS, SUPPORTED_UNITS, polarSetV2Schema,
  validatePolar, toCanonicalPolar, convertPolarUnits, migratePolarToV2
} = require('../src')

const validateSchema = new Ajv({ strict: true, allErrors: true }).compile(polarSetV2Schema)

function document() {
  return {
    kind: 'polarSet',
    schemaVersion: '2.0.0',
    units: { ...CANONICAL_UNITS },
    symmetry: { portStarboardSymmetric: true },
    best: {
      axes: { tws: [5], twa: [1, 2] },
      values: { boatSpeedMatrix: [[3, 4]] },
      derived: { rows: [{ tws: 5, beat: { twa: 0.8, tbs: 2, vmg: 1.4 } }] }
    },
    waveCorrection: {
      heights: [
        {
          significantWaveHeight: 0,
          axes: { wavePeriod: [1, 16], waveAngle: [0, Math.PI] },
          values: { speedFactorMatrix: [[1, 1], [1, 1]] }
        },
        {
          significantWaveHeight: 2,
          axes: {
            wavePeriod: [1, 5, 10, 15],
            waveAngle: [0, Math.PI / 18, 4 * Math.PI / 9, Math.PI / 2, 5 * Math.PI / 9, Math.PI]
          },
          values: {
            speedFactorMatrix: [
              [0.9, 0.9, 0.95, 0.95, 1, 1],
              [0.9, 0.9, 0.95, 0.95, 1, 1.1],
              [0.9, 0.9, 0.95, 0.95, 1, 1.15],
              [0.9, 0.9, 0.95, 0.95, 1, 1.2]
            ]
          }
        }
      ]
    }
  }
}

function success(result) {
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  return result.value
}

function near(actual, expected) {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected))
    for (const key of Object.keys(expected)) near(actual[key], expected[key])
  } else assert.equal(actual, expected)
}

function rejected(data, path) {
  for (const result of [validatePolar(data), toCanonicalPolar(data), convertPolarUnits(data, CANONICAL_UNITS), migratePolarToV2(data)]) {
    assert.equal(result.valid, false)
    assert.equal(result.value, undefined)
    assert.ok(result.errors.some(e => e.path === path), JSON.stringify(result.errors))
  }
}

describe('wave correction schema and helpers', () => {
  it('accepts independent grids and factors from the TimeZero 2m sample', () => {
    const data = document()
    assert.equal(validateSchema(data), true, JSON.stringify(validateSchema.errors))
    success(validatePolar(data))
    assert.equal(data.waveCorrection.heights[1].values.speedFactorMatrix[3][5], 1.2)
    assert.ok(SUPPORTED_UNITS.waveAngle.includes('deg'))
    assert.deepEqual(SUPPORTED_UNITS.wavePeriod, ['s'])
  })

  it('accepts partial coverage without inventing a zero-height layer or requiring end angles', () => {
    const data = document()
    data.waveCorrection.heights = [{
      significantWaveHeight: 0.5,
      axes: { wavePeriod: [5], waveAngle: [Math.PI / 2] },
      values: { speedFactorMatrix: [[0]] }
    }]
    success(validatePolar(data))
    assert.deepEqual(success(toCanonicalPolar(data)), data)
  })

  it('keeps the correction optional and does not synthesize one during v1 migration', () => {
    const data = document()
    delete data.waveCorrection
    success(validatePolar(data))
    assert.equal(success(toCanonicalPolar(data)).waveCorrection, undefined)
    const v1 = {
      kind: 'polarTable', schemaVersion: '1.0.0',
      units: data.units, symmetry: data.symmetry, ...data.best
    }
    assert.equal(success(migratePolarToV2(v1)).waveCorrection, undefined)
    v1.waveCorrection = document().waveCorrection
    assert.equal(validatePolar(v1).valid, false)
  })

  const invalidCases = [
    ['unordered heights', d => { d.waveCorrection.heights.reverse() }, '/waveCorrection/heights/1/significantWaveHeight'],
    ['duplicate heights', d => { d.waveCorrection.heights[1].significantWaveHeight = 0 }, '/waveCorrection/heights/1/significantWaveHeight'],
    ['negative height', d => { d.waveCorrection.heights[0].significantWaveHeight = -1 }, '/waveCorrection/heights/0/significantWaveHeight'],
    ['non-finite height', d => { d.waveCorrection.heights[0].significantWaveHeight = Infinity }, '/waveCorrection/heights/0/significantWaveHeight'],
    ['unordered periods', d => { d.waveCorrection.heights[0].axes.wavePeriod = [16, 1] }, '/waveCorrection/heights/0/axes/wavePeriod/1'],
    ['duplicate periods', d => { d.waveCorrection.heights[0].axes.wavePeriod = [1, 1] }, '/waveCorrection/heights/0/axes/wavePeriod/1'],
    ['zero period', d => { d.waveCorrection.heights[0].axes.wavePeriod[0] = 0 }, '/waveCorrection/heights/0/axes/wavePeriod/0'],
    ['non-finite period', d => { d.waveCorrection.heights[0].axes.wavePeriod[0] = NaN }, '/waveCorrection/heights/0/axes/wavePeriod/0'],
    ['unordered angles', d => { d.waveCorrection.heights[0].axes.waveAngle.reverse() }, '/waveCorrection/heights/0/axes/waveAngle/1'],
    ['duplicate angles', d => { d.waveCorrection.heights[0].axes.waveAngle = [0, 0] }, '/waveCorrection/heights/0/axes/waveAngle/1'],
    ['negative angle', d => { d.waveCorrection.heights[0].axes.waveAngle[0] = -0.1 }, '/waveCorrection/heights/0/axes/waveAngle/0'],
    ['angle beyond pi', d => { d.waveCorrection.heights[0].axes.waveAngle[1] = Math.PI + 0.01 }, '/waveCorrection/heights/0/axes/waveAngle/1'],
    ['missing matrix row', d => { d.waveCorrection.heights[1].values.speedFactorMatrix.pop() }, '/waveCorrection/heights/1/values/speedFactorMatrix'],
    ['missing matrix column', d => { d.waveCorrection.heights[1].values.speedFactorMatrix[1].pop() }, '/waveCorrection/heights/1/values/speedFactorMatrix/1'],
    ['negative factor', d => { d.waveCorrection.heights[1].values.speedFactorMatrix[0][0] = -0.1 }, '/waveCorrection/heights/1/values/speedFactorMatrix/0/0'],
    ['non-finite factor', d => { d.waveCorrection.heights[1].values.speedFactorMatrix[0][0] = Infinity }, '/waveCorrection/heights/1/values/speedFactorMatrix/0/0'],
    ['null factor', d => { d.waveCorrection.heights[1].values.speedFactorMatrix[0][0] = null }, '/waveCorrection/heights/1/values/speedFactorMatrix/0/0'],
    ['nonneutral calm-water factor', d => { d.waveCorrection.heights[0].values.speedFactorMatrix[1][1] = 0.99 }, '/waveCorrection/heights/0/values/speedFactorMatrix/1/1']
  ]
  for (const [name, mutate, path] of invalidCases) {
    it(`rejects ${name} with a precise error path`, () => {
      const data = document()
      mutate(data)
      rejected(data, path)
    })
  }

  it('rejects malformed wave data before traversal without throwing', () => {
    for (const correction of [null, [], {}, { heights: [] }, { heights: [null] }, {
      heights: [{ significantWaveHeight: 1, axes: null, values: null }]
    }]) {
      const data = document()
      data.waveCorrection = correction
      assert.equal(validateSchema(data), false)
      for (const fn of [validatePolar, toCanonicalPolar, migratePolarToV2]) {
        assert.equal(fn(data).valid, false)
      }
    }
    const data = document()
    data.waveCorrection.heights[0].values.speedFactorMatrix = [null]
    assert.equal(toCanonicalPolar(data).valid, false)
    data.waveCorrection.heights[0].values.speedFactorMatrix = [[1], [1]]
    data.waveCorrection.extra = true
    assert.equal(validateSchema(data), false)
    assert.equal(toCanonicalPolar(data).valid, false)
  })

  it('converts wave angle independently, preserves factors and round-trips without mutation', () => {
    const data = document()
    const snapshot = structuredClone(data)
    const units = {
      tws: 'kn', twa: 'deg', boatSpeed: 'kn',
      significantWaveHeight: 'm', wavePeriod: 's', waveAngle: 'deg', speedFactor: '1'
    }
    const display = success(convertPolarUnits(data, units))
    assert.deepEqual(data, snapshot)
    assert.deepEqual(display.waveCorrection.heights[0].axes.waveAngle, [0, 180])
    assert.deepEqual(display.waveCorrection.heights[1].values, data.waveCorrection.heights[1].values)
    assert.deepEqual(display.waveCorrection.heights[1].axes.wavePeriod, [1, 5, 10, 15])
    assert.equal(display.waveCorrection.heights[1].significantWaveHeight, 2)
    const canonical = success(toCanonicalPolar(display))
    assert.equal(canonical.units.waveAngle, 'rad')
    for (const [i, layer] of canonical.waveCorrection.heights.entries()) {
      layer.axes.waveAngle.forEach((value, j) => {
        assert.ok(Math.abs(value - data.waveCorrection.heights[i].axes.waveAngle[j]) < 1e-12)
      })
    }
    for (const field of ['significantWaveHeight', 'wavePeriod', 'waveAngle', 'speedFactor']) delete canonical.units[field]
    near(canonical, data)
    const migrated = success(migratePolarToV2(data))
    assert.deepEqual(migrated, data)
    migrated.waveCorrection.heights[1].values.speedFactorMatrix[0][0] = 0.4
    assert.deepEqual(data, snapshot)
    display.waveCorrection.heights[0].axes.wavePeriod[0] = 2
    assert.deepEqual(data, snapshot)
  })

  it('does not use TWA units for omitted wave angle units or modify baseline targets', () => {
    const data = document()
    const display = success(convertPolarUnits(data, { tws: 'm/s', twa: 'deg', boatSpeed: 'm/s' }))
    assert.deepEqual(display.waveCorrection, data.waveCorrection)
    near(success(toCanonicalPolar(display)), data)
    const waveOnly = success(convertPolarUnits(data, { ...CANONICAL_UNITS, waveAngle: 'deg' }))
    assert.deepEqual(waveOnly.best, data.best)
    assert.equal(waveOnly.waveCorrection.heights[0].axes.waveAngle[1], 180)
  })

  it('checks angle bounds after conversion and preserves canonical optional declarations', () => {
    const units = { ...CANONICAL_UNITS, waveAngle: 'degrees', significantWaveHeight: 'm', wavePeriod: 's', speedFactor: '1' }
    const display = success(convertPolarUnits(document(), units))
    success(validatePolar(success(toCanonicalPolar(display))))
    display.waveCorrection.heights[0].axes.waveAngle[1] = 181
    assert.equal(toCanonicalPolar(display).valid, false)
    const data = document()
    data.units = { ...units, waveAngle: 'rad' }
    assert.deepEqual(success(toCanonicalPolar(data)), data)
  })

  it('rejects unsupported wave units on both input and output and v1 documents', () => {
    for (const units of [
      { significantWaveHeight: 'ft' }, { wavePeriod: 'min' },
      { waveAngle: 'grads' }, { speedFactor: '%' }
    ]) {
      const data = document()
      Object.assign(data.units, units)
      assert.equal(toCanonicalPolar(data).valid, false)
      assert.equal(convertPolarUnits(document(), { ...CANONICAL_UNITS, ...units }).valid, false)
    }
    const v2 = document()
    const v1 = { ...v2.best, kind: 'polarTable', schemaVersion: '1.0.0', units: v2.units, symmetry: v2.symmetry }
    assert.equal(convertPolarUnits(v1, { ...CANONICAL_UNITS, waveAngle: 'deg' }).valid, false)
  })
})
