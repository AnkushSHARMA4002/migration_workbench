const { HttpError } = require('./errors');

const TYPES = ['string', 'number', 'integer', 'boolean', 'date', 'email'];

function normalizeSchema(input) {
  let value = input;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new HttpError(400, 'Target schema is not valid JSON', 'validation'); }
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'Target schema must be a non-empty array of fields', 'validation');
  }
  if (value.length > 100) throw new HttpError(400, 'Target schema supports at most 100 fields', 'validation');
  const seen = new Set();
  return value.map((f, i) => {
    if (!f || typeof f !== 'object') throw new HttpError(400, `Schema field ${i + 1} must be an object`, 'validation');
    const name = String(f.name || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new HttpError(400, `Schema field ${i + 1} has an invalid name "${name}"`, 'validation');
    }
    if (seen.has(name)) throw new HttpError(400, `Schema field "${name}" is duplicated`, 'validation');
    seen.add(name);
    const type = f.type === undefined ? 'string' : String(f.type);
    if (!TYPES.includes(type)) {
      throw new HttpError(400, `Schema field "${name}" has unsupported type "${type}". Use one of: ${TYPES.join(', ')}`, 'validation');
    }
    const out = { name, type, required: Boolean(f.required) };
    if (f.default !== undefined && f.default !== null && f.default !== '') out.default = String(f.default);
    return out;
  });
}

module.exports = { normalizeSchema, TYPES };
