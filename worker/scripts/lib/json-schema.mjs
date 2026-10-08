import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

export function assertSchema(schema, value, label) {
  const validate = ajv.compile(schema)
  if (validate(value)) return
  const details = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
  throw new Error(`${label} does not match its schema: ${details ?? 'unknown schema error'}`)
}
