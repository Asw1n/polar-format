'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const Ajv = require('ajv')
const schema = require('polar-format/schema/polar-set-v2.schema.json')

const validate = new Ajv({ allErrors: true, strict: true }).compile(schema)

function table() {
  return {
    axes: { tws: [3, 5], twa: [1, 2] },
    values: { boatSpeedMatrix: [[2, 3], [3, 4]] }
  }
}

function document() {
  return {
    kind: 'polarSet',
    schemaVersion: '2.0.0',
    units: { tws: 'm/s', twa: 'rad', boatSpeed: 'm/s' },
    symmetry: { portStarboardSymmetric: true },
    best: table()
  }
}

function accepts(value) {
  assert.equal(validate(value), true, JSON.stringify(validate.errors))
}

function rejects(value) {
  assert.equal(validate(value), false)
}

describe('version-2 polar set schema', () => {
  it('accepts a best-only document without extra quantities', () => {
    accepts(document())
  })

  it('accepts sail combinations, independent grids and per-table derived values', () => {
    const data = document()
    data.best.values.heelMatrix = [[0.1, 0.2], [0.2, 0.3]]
    data.best.values.reefMatrix = [[1, 1], [1, 0.8]]
    data.best.values.flatMatrix = [[1, 1], [0.9, 0.8]]
    data.best.sailplanIdMatrix = [['jib', null], ['jib', 'jib']]
    data.best.derived = {
      rows: [{
        tws: 3,
        beat: { twa: 0.8, tbs: 2, vmg: 1.39, heel: 0.1, reef: 1, flat: 0.95, sailplanId: 'jib' },
        run: { twa: 2.8, tbs: 3, vmg: -2.83 },
        maxSpeed: 3.2,
        maxSpeedAngle: 1.8
      }]
    }
    data.sailplans = [{
      id: 'jib',
      name: 'Main + J1',
      sails: [
        { name: 'Main', type: 'mainsail' },
        { name: 'J1', type: 'headsail', sourceId: '2024 J1', area: 33.01 }
      ],
      table: {
        axes: { tws: [3], twa: [0.9] },
        values: { boatSpeedMatrix: [[2]] },
        derived: {
          rows: [{ tws: 3, beat: { twa: 0.8, tbs: 2, vmg: 1.39, heel: 0.1 }, run: null }]
        }
      }
    }]
    accepts(data)
  })

  it('represents unavailable speeds and unknown auxiliary data with null', () => {
    const data = document()
    data.best.values.boatSpeedMatrix[0][0] = null
    data.best.values.heelMatrix = [[null, null], [0.2, 0.3]]
    accepts(data)
  })

  it('preserves source factors slightly above one', () => {
    const data = document()
    data.best.values.reefMatrix = [[1.0006, 1], [0.5, 1]]
    data.best.values.flatMatrix = [[1.0004, 1], [0.6, 1]]
    accepts(data)
  })

  for (const version of ['1.0.0', '2.1.0', '3.0.0', '2.0']) {
    it(`rejects unsupported version ${version}`, () => {
      rejects({ ...document(), schemaVersion: version })
    })
  }

  for (const field of ['kind', 'schemaVersion', 'units', 'symmetry', 'best']) {
    it(`requires ${field}`, () => {
      const data = document()
      delete data[field]
      rejects(data)
    })
  }

  it('rejects nested versions and unknown fields', () => {
    const data = document()
    data.best.schemaVersion = '1.0.0'
    rejects(data)
    delete data.best.schemaVersion
    data.best.values.unknownMatrix = [[1]]
    rejects(data)
  })

  it('requires boat speed in every table', () => {
    const data = document()
    delete data.best.values.boatSpeedMatrix
    rejects(data)
  })

  it('rejects noncanonical units and asymmetric documents', () => {
    rejects({ ...document(), units: { tws: 'kn', twa: 'deg', boatSpeed: 'kn' } })
    rejects({ ...document(), symmetry: { portStarboardSymmetric: false } })
    rejects({ ...document(), units: { ...document().units, heel: 'deg' } })
  })

  for (const [field, value] of [
    ['boatSpeedMatrix', -1],
    ['heelMatrix', -0.1],
    ['heelMatrix', Math.PI],
    ['reefMatrix', -0.1],
    ['flatMatrix', 'full']
  ]) {
    it(`rejects invalid ${field} cell ${value}`, () => {
      const data = document()
      data.best.values[field] = [[value, 1], [1, 1]]
      rejects(data)
    })
  }

  it('rejects invalid axes and empty matrices', () => {
    const data = document()
    data.best.axes.tws = [0]
    rejects(data)
    data.best.axes.tws = [3]
    data.best.axes.twa = [Math.PI + 0.01]
    rejects(data)
    data.best.axes.twa = [1]
    data.best.values.boatSpeedMatrix = []
    rejects(data)
  })

  it('requires sailplan identity and table', () => {
    const data = document()
    data.sailplans = [{ name: 'J1', table: table() }]
    rejects(data)
    data.sailplans = [{ id: 'jib', name: 'J1' }]
    rejects(data)
  })

  it('does not allow envelope attribution on fixed sailplan tables', () => {
    const data = document()
    data.sailplans = [{ id: 'jib', name: 'J1', table: table() }]
    data.sailplans[0].table.sailplanIdMatrix = [['jib', 'jib'], ['jib', 'jib']]
    rejects(data)
    delete data.sailplans[0].table.sailplanIdMatrix
    data.sailplans[0].table.derived = {
      rows: [{ tws: 3, run: { twa: 2.8, tbs: 3, vmg: -2.83, sailplanId: 'jib' } }]
    }
    rejects(data)
  })
})
