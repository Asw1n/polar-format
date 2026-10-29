'use strict'

const Ajv = require('ajv')
const polarTableSchema = require('./schema/polar-table.schema.json')
const polarSetV2Schema = require('./schema/polar-set-v2.schema.json')

const CANONICAL_UNITS = Object.freeze({
  tws: 'm/s',
  twa: 'rad',
  boatSpeed: 'm/s'
})

const SPEED_FACTORS_TO_MPS = Object.freeze({
  'm/s': 1,
  kn: 1 / 1.94384,
  kt: 1 / 1.94384,
  kts: 1 / 1.94384,
  knot: 1 / 1.94384,
  knots: 1 / 1.94384
})

const ANGLE_FACTORS_TO_RAD = Object.freeze({
  rad: 1,
  deg: Math.PI / 180,
  degree: Math.PI / 180,
  degrees: Math.PI / 180
})

const SUPPORTED_UNITS = Object.freeze({
  tws: Object.freeze(Object.keys(SPEED_FACTORS_TO_MPS)),
  twa: Object.freeze(Object.keys(ANGLE_FACTORS_TO_RAD)),
  boatSpeed: Object.freeze(Object.keys(SPEED_FACTORS_TO_MPS)),
  heel: Object.freeze(Object.keys(ANGLE_FACTORS_TO_RAD)),
  reef: Object.freeze(['1']),
  flat: Object.freeze(['1']),
  significantWaveHeight: Object.freeze(['m']),
  wavePeriod: Object.freeze(['s']),
  waveAngle: Object.freeze(Object.keys(ANGLE_FACTORS_TO_RAD)),
  speedFactor: Object.freeze(['1'])
})

const V2_OPTIONAL_UNITS = Object.freeze({
  heel: 'rad',
  reef: '1',
  flat: '1',
  significantWaveHeight: 'm',
  wavePeriod: 's',
  waveAngle: 'rad',
  speedFactor: '1'
})

const ajv = new Ajv({ allErrors: true, strict: true })
const validateSchema = ajv.compile(polarTableSchema)
const validateV2Schema = ajv.compile(polarSetV2Schema)

function convertibleSchema(schema, version) {
  const converted = structuredClone(schema)
  converted.$id = `convertible-v${version}`
  converted.properties.units.properties = {
    tws: { enum: SUPPORTED_UNITS.tws },
    twa: { enum: SUPPORTED_UNITS.twa },
    boatSpeed: { enum: SUPPORTED_UNITS.boatSpeed },
    ...(version === 2
      ? Object.fromEntries(Object.keys(V2_OPTIONAL_UNITS).map(quantity => [quantity, { enum: SUPPORTED_UNITS[quantity] }]))
      : {})
  }
  // Angular bounds are checked after conversion to SI.
  const angles = version === 1
    ? [
        converted.properties.axes.properties.twa.items,
        converted.$defs.targetPoint.properties.twa,
        converted.$defs.derivedRow.properties.maxSpeedAngle
      ]
    : [converted.$defs.angle, converted.$defs.heel]
  for (const angle of angles) delete angle.maximum
  return ajv.compile(converted)
}

const convertibleValidators = [
  undefined,
  convertibleSchema(polarTableSchema, 1),
  convertibleSchema(polarSetV2Schema, 2)
]

function ok(value) {
  return { valid: true, value, errors: [] }
}

function fail(errors) {
  return { valid: false, value: undefined, errors }
}

function error(path, message, keyword = 'polar-format') {
  return { path, message, keyword }
}

function mapAjvErrors(errors = []) {
  return errors.map(item => error(item.instancePath || '/', item.message || 'Invalid value', item.keyword))
}

function validatePolarTable(data) {
  const versionErrors = documentVersionErrors(data, 1)
  if (versionErrors.length) return fail(versionErrors)
  const schemaValid = validateSchema(data)
  const errors = schemaValid ? [] : mapAjvErrors(validateSchema.errors)
  if (schemaValid) errors.push(...validateSemanticRules(data))
  return errors.length === 0 ? ok(data) : fail(errors)
}

function toCanonicalPolarTable(data) {
  const conversion = convertPolarTableUnits(data, CANONICAL_UNITS)
  if (!conversion.valid) return conversion
  return validatePolarTable(conversion.value)
}

function convertPolarTableUnits(data, targetUnits) {
  const versionErrors = documentVersionErrors(data, 1)
  if (versionErrors.length) return fail(versionErrors)
  return convertPolarUnits(data, targetUnits)
}

function documentVersionErrors(data, expectedVersion) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [error('/', 'Expected a polar document object')]
  }
  const version = data.schemaVersion === '1.0.0' ? 1 : data.schemaVersion === '2.0.0' ? 2 : undefined
  if (!version) return [error('/schemaVersion', 'unsupported schema version; expected 1.0.0 or 2.0.0')]
  if (expectedVersion && version !== expectedVersion) {
    return [error('/schemaVersion', `expected version ${expectedVersion}.0.0`)]
  }
  const kind = version === 1 ? 'polarTable' : 'polarSet'
  return data.kind === kind ? [] : [error('/kind', `must be ${kind} for schema version ${data.schemaVersion}`)]
}

function validatePolar(data) {
  const errors = documentVersionErrors(data)
  if (errors.length) return fail(errors)
  if (data.schemaVersion === '1.0.0') return validatePolarTable(data)
  if (!validateV2Schema(data)) return fail(mapAjvErrors(validateV2Schema.errors))
  errors.push(...validateV2Semantics(data))
  return errors.length ? fail(errors) : ok(data)
}

function validateV2Semantics(data) {
  const errors = []
  const ids = new Set()
  for (const [index, sailplan] of (data.sailplans || []).entries()) {
    if (ids.has(sailplan.id)) errors.push(error(`/sailplans/${index}/id`, 'must be unique within the document'))
    ids.add(sailplan.id)
  }
  function checkReference(id, path) {
    if (id !== null && id !== undefined && !ids.has(id)) errors.push(error(path, 'must reference a sailplan in this document'))
  }
  const tables = [[data.best, '/best'], ...(data.sailplans || []).map((s, i) => [s.table, `/sailplans/${i}/table`])]
  for (const [table, path] of tables) {
    errors.push(...validateStrictlyIncreasing(table.axes.tws, `${path}/axes/tws`))
    errors.push(...validateStrictlyIncreasing(table.axes.twa, `${path}/axes/twa`))
    const matrices = Object.entries(table.values).map(([name, matrix]) => [matrix, `${path}/values/${name}`])
    if (table.sailplanIdMatrix) matrices.push([table.sailplanIdMatrix, `${path}/sailplanIdMatrix`])
    for (const [matrix, matrixPath] of matrices) {
      if (matrix.length !== table.axes.tws.length) errors.push(error(matrixPath, 'row count must match axes.tws length'))
      matrix.forEach((row, i) => {
        if (row.length !== table.axes.twa.length) errors.push(error(`${matrixPath}/${i}`, 'length must match axes.twa length'))
        row.forEach((value, j) => {
          if (table.values.boatSpeedMatrix[i]?.[j] === null && value !== null) {
            errors.push(error(`${matrixPath}/${i}/${j}`, 'must be null where boat speed is unavailable'))
          }
          if (matrix === table.sailplanIdMatrix) checkReference(value, `${matrixPath}/${i}/${j}`)
        })
      })
    }
    const seen = new Set()
    for (const [i, row] of (table.derived?.rows || []).entries()) {
      const rowPath = `${path}/derived/rows/${i}`
      if (!table.axes.tws.includes(row.tws)) errors.push(error(`${rowPath}/tws`, 'must occur in this table\'s TWS axis'))
      if (seen.has(row.tws)) errors.push(error(`${rowPath}/tws`, 'must not duplicate a derived row'))
      seen.add(row.tws)
      for (const target of ['beat', 'run']) checkReference(row[target]?.sailplanId, `${rowPath}/${target}/sailplanId`)
    }
  }
  if (data.waveCorrection) errors.push(...validateWaveCorrection(data.waveCorrection))
  return errors
}

function validateWaveCorrection(correction) {
  const errors = []
  errors.push(...validateStrictlyIncreasing(
    correction.heights.map(layer => layer.significantWaveHeight),
    '/waveCorrection/heights'
  ).map(item => ({ ...item, path: `${item.path}/significantWaveHeight` })))
  correction.heights.forEach((layer, index) => {
    const path = `/waveCorrection/heights/${index}`
    errors.push(...validateStrictlyIncreasing(layer.axes.wavePeriod, `${path}/axes/wavePeriod`))
    errors.push(...validateStrictlyIncreasing(layer.axes.waveAngle, `${path}/axes/waveAngle`))
    const matrix = layer.values.speedFactorMatrix
    const matrixPath = `${path}/values/speedFactorMatrix`
    if (matrix.length !== layer.axes.wavePeriod.length) {
      errors.push(error(matrixPath, 'row count must match axes.wavePeriod length'))
    }
    matrix.forEach((row, i) => {
      if (row.length !== layer.axes.waveAngle.length) {
        errors.push(error(`${matrixPath}/${i}`, 'length must match axes.waveAngle length'))
      }
      if (layer.significantWaveHeight === 0) {
        row.forEach((factor, j) => {
          if (factor !== 1) errors.push(error(`${matrixPath}/${i}/${j}`, 'must be one at zero significant wave height'))
        })
      }
    })
  })
  return errors
}

function toCanonicalPolar(data) {
  return convertPolarUnits(data, CANONICAL_UNITS)
}

function convertPolarUnits(data, targetUnits) {
  const errors = documentVersionErrors(data)
  if (errors.length) return fail(errors)
  const version = data.schemaVersion === '1.0.0' ? 1 : 2
  const validateInput = convertibleValidators[version]
  if (!validateInput(data)) return fail(mapAjvErrors(validateInput.errors))
  errors.push(...validateTargetUnits(targetUnits))
  if (version === 2 && targetUnits && typeof targetUnits === 'object') {
    for (const field of Object.keys(V2_OPTIONAL_UNITS)) {
      if (targetUnits[field] !== undefined && !SUPPORTED_UNITS[field].includes(targetUnits[field])) {
        errors.push(error(`/targetUnits/${field}`, `unsupported ${field} unit`))
      }
    }
  }
  if (targetUnits && typeof targetUnits === 'object') {
    const allowed = ['tws', 'twa', 'boatSpeed', ...(version === 2 ? Object.keys(V2_OPTIONAL_UNITS) : [])]
    for (const field of Object.keys(targetUnits)) {
      if (!allowed.includes(field)) errors.push(error(`/targetUnits/${field}`, 'unknown unit quantity'))
    }
  }
  if (errors.length) return fail(errors)
  const canonical = convertDocument(data, CANONICAL_UNITS)
  const validation = validatePolar(canonical)
  if (!validation.valid) return validation
  const converted = convertDocument(canonical, targetUnits)
  if (!allNumbersFinite(converted)) return fail([error('/', 'unit conversion produced a non-finite number')])
  return ok(converted)
}

function allNumbersFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  return !value || typeof value !== 'object' || Object.values(value).every(allNumbersFinite)
}

function convertDocument(data, targetUnits) {
  const converted = structuredClone(data)
  const twsFactor = conversionFactor(data.units.tws, targetUnits.tws, SPEED_FACTORS_TO_MPS)
  const twaFactor = conversionFactor(data.units.twa, targetUnits.twa, ANGLE_FACTORS_TO_RAD)
  const speedFactor = conversionFactor(data.units.boatSpeed, targetUnits.boatSpeed, SPEED_FACTORS_TO_MPS)
  const heelFactor = conversionFactor(data.units.heel || 'rad', targetUnits.heel || 'rad', ANGLE_FACTORS_TO_RAD)
  converted.units = { ...targetUnits }
  if (data.kind === 'polarSet') {
    for (const [field, unit] of Object.entries(V2_OPTIONAL_UNITS)) {
      if (data.units[field] !== undefined && targetUnits[field] === undefined) converted.units[field] = unit
    }
    if (converted.waveCorrection) {
      const waveAngleFactor = conversionFactor(data.units.waveAngle || 'rad', targetUnits.waveAngle || 'rad', ANGLE_FACTORS_TO_RAD)
      for (const layer of converted.waveCorrection.heights) {
        layer.axes.waveAngle = layer.axes.waveAngle.map(value => value * waveAngleFactor)
      }
    }
  }
  const tables = data.kind === 'polarTable' ? [converted] : [converted.best, ...(converted.sailplans || []).map(s => s.table)]
  for (const table of tables) {
    table.axes.tws = table.axes.tws.map(value => value * twsFactor)
    table.axes.twa = table.axes.twa.map(value => value * twaFactor)
    for (const [field, factor] of [['boatSpeedMatrix', speedFactor], ['heelMatrix', heelFactor]]) {
      if (table.values[field]) table.values[field] = table.values[field].map(row => row.map(value => value === null ? null : value * factor))
    }
    if (table.derived) {
      table.derived = convertDerived(table.derived, twsFactor, twaFactor, speedFactor)
      for (const row of table.derived.rows || []) {
        for (const target of [row.beat, row.run]) {
          if (target?.heel !== undefined) target.heel *= heelFactor
        }
      }
    }
  }
  return converted
}

function migratePolarToV2(data) {
  const validation = validatePolar(data)
  if (!validation.valid) return validation
  if (data.schemaVersion === '2.0.0') return ok(structuredClone(data))
  const { kind, schemaVersion, axes, values, derived, ...metadata } = structuredClone(data)
  const migrated = {
    ...metadata,
    kind: 'polarSet',
    schemaVersion: '2.0.0',
    best: { axes, values, ...(derived === undefined ? {} : { derived }) }
  }
  return validatePolar(migrated)
}

function conversionFactor(sourceUnit, targetUnit, factorsToBase) {
  return factorsToBase[sourceUnit] / factorsToBase[targetUnit]
}

function convertDerived(derived, twsFactor, twaFactor, boatSpeedFactor) {
  if (!Array.isArray(derived.rows)) return { ...derived }
  return {
    ...derived,
    rows: derived.rows.map(row => ({
      ...row,
      tws: row.tws * twsFactor,
      ...(row.beat === undefined ? {} : { beat: convertTarget(row.beat, twaFactor, boatSpeedFactor) }),
      ...(row.run === undefined ? {} : { run: convertTarget(row.run, twaFactor, boatSpeedFactor) }),
      ...(row.maxSpeed === undefined ? {} : { maxSpeed: row.maxSpeed * boatSpeedFactor }),
      ...(row.maxSpeedAngle === undefined ? {} : { maxSpeedAngle: row.maxSpeedAngle * twaFactor })
    }))
  }
}

function convertTarget(target, twaFactor, boatSpeedFactor) {
  if (target === null) return null
  return {
    ...target,
    twa: target.twa * twaFactor,
    tbs: target.tbs * boatSpeedFactor,
    vmg: target.vmg * boatSpeedFactor
  }
}

function validateTargetUnits(units) {
  if (!units || typeof units !== 'object' || Array.isArray(units)) return [error('/targetUnits', 'Expected target units object')]
  const errors = []
  if (!SUPPORTED_UNITS.tws.includes(units.tws)) errors.push(error('/targetUnits/tws', `unsupported TWS unit '${units.tws}'`))
  if (!SUPPORTED_UNITS.twa.includes(units.twa)) errors.push(error('/targetUnits/twa', `unsupported TWA unit '${units.twa}'`))
  if (!SUPPORTED_UNITS.boatSpeed.includes(units.boatSpeed)) errors.push(error('/targetUnits/boatSpeed', `unsupported boatSpeed unit '${units.boatSpeed}'`))
  return errors
}

function validateNumericArray(values, path, { min, minExclusive } = {}) {
  if (!Array.isArray(values) || values.length === 0) return [error(path, 'must be a non-empty array')]
  return values.flatMap((value, index) => {
    const itemErrors = []
    if (!Number.isFinite(value)) itemErrors.push(error(`${path}/${index}`, 'must be a finite number'))
    if (Number.isFinite(min) && value < min) itemErrors.push(error(`${path}/${index}`, `must be >= ${min}`))
    if (Number.isFinite(minExclusive) && value <= minExclusive) itemErrors.push(error(`${path}/${index}`, `must be > ${minExclusive}`))
    return itemErrors
  })
}

function validateMatrix(matrix, twsAxis, twaAxis) {
  if (!Array.isArray(matrix)) return [error('/values/boatSpeedMatrix', 'must be an array')]
  const errors = []
  if (Array.isArray(twsAxis) && matrix.length !== twsAxis.length) {
    errors.push(error('/values/boatSpeedMatrix', 'row count must match axes.tws length'))
  }

  matrix.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      errors.push(error(`/values/boatSpeedMatrix/${rowIndex}`, 'must be an array'))
      return
    }
    if (Array.isArray(twaAxis) && row.length !== twaAxis.length) {
      errors.push(error(`/values/boatSpeedMatrix/${rowIndex}`, 'length must match axes.twa length'))
    }
    errors.push(...validateNumericArray(row, `/values/boatSpeedMatrix/${rowIndex}`, { min: 0 }))
  })
  return errors
}

function validateSemanticRules(data) {
  const errors = []
  errors.push(...validateStrictlyIncreasing(data.axes.tws, '/axes/tws'))
  errors.push(...validateStrictlyIncreasing(data.axes.twa, '/axes/twa'))
  errors.push(...validateMatrix(data.values.boatSpeedMatrix, data.axes.tws, data.axes.twa))

  errors.push(...validateCanonicalTwaRange(data.axes.twa, '/axes/twa'))
  if (data.derived?.rows) errors.push(...validateDerivedRows(data.derived.rows))

  return errors
}

function validateStrictlyIncreasing(values, path) {
  if (!Array.isArray(values)) return []
  const errors = []
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      errors.push(error(`${path}/${index}`, 'must be strictly increasing'))
    }
  }
  return errors
}

function validateCanonicalTwaRange(values, path) {
  if (!Array.isArray(values)) return []
  return values.flatMap((value, index) => value > Math.PI
    ? [error(`${path}/${index}`, 'must be <= pi radians')]
    : [])
}

function validateDerivedRows(rows) {
  const errors = []
  rows.forEach((row, rowIndex) => {
    if (row.beat) errors.push(...validateTargetRange(row.beat, `/derived/rows/${rowIndex}/beat`))
    if (row.run) errors.push(...validateTargetRange(row.run, `/derived/rows/${rowIndex}/run`))
    if (Number.isFinite(row.maxSpeedAngle) && row.maxSpeedAngle > Math.PI) {
      errors.push(error(`/derived/rows/${rowIndex}/maxSpeedAngle`, 'must be <= pi radians'))
    }
  })
  return errors
}

function validateTargetRange(target, path) {
  return Number.isFinite(target.twa) && target.twa > Math.PI
    ? [error(`${path}/twa`, 'must be <= pi radians')]
    : []
}

module.exports = {
  CANONICAL_UNITS,
  SUPPORTED_UNITS,
  polarTableSchema,
  polarSetV2Schema,
  validatePolar,
  toCanonicalPolar,
  convertPolarUnits,
  migratePolarToV2,
  validatePolarTable,
  toCanonicalPolarTable,
  convertPolarTableUnits
}