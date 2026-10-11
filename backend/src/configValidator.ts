import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from './schema/business_config.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

/** Returns null if valid, otherwise a list of readable errors. */
export function validateConfig(config: unknown): string[] | null {
  if (validate(config)) return null;
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}
