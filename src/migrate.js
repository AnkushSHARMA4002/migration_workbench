const db = require('./db');
const logger = require('./logger');
const { HttpError } = require('./errors');
const { applyTransform, coerce } = require('./transforms');
const { setStatus } = require('./projects');

function buildTargetRow(schema, mappings, sourceRow) {
  const data = {};
  const errors = [];
  for (const field of schema) {
    const mapping = mappings.find((m) => m.target_field === field.name && m.status === 'approved');
    let value = '';
    let raw = '';
    if (mapping) {
      raw = mapping.source_field ? sourceRow[mapping.source_field] : '';
      try {
        value = mapping.source_field ? applyTransform(mapping.transform, raw) : '';
      } catch (err) {
        errors.push({ field: field.name, message: err.message, raw: String(raw) });
        data[field.name] = '';
        continue;
      }
      if (value === '' && mapping.default_value) value = mapping.default_value;
    } else if (field.default !== undefined) {
      value = field.default;
    }
    try {
      data[field.name] = coerce(field.type, value);
    } catch (err) {
      errors.push({ field: field.name, message: err.message, raw: String(raw === undefined ? '' : raw) });
      data[field.name] = '';
      continue;
    }
    if (field.required && data[field.name] === '') {
      errors.push({ field: field.name, message: 'Required value is missing', raw: String(raw === undefined ? '' : raw) });
    }
  }
  return { data, errors };
}

function assertReady(project, schema, mappings) {
  if (!mappings.length) throw new HttpError(409, 'Generate and review a plan before migrating', 'plan_required');
  const pending = mappings.filter((m) => m.status === 'pending').length;
  if (pending) throw new HttpError(409, `${pending} mapping(s) still need your review`, 'review_required');
  const approved = mappings.filter((m) => m.status === 'approved');
  const uncovered = schema.filter((f) => f.required && f.default === undefined && !approved.some((m) => m.target_field === f.name));
  if (uncovered.length) {
    throw new HttpError(409, `Required target fields have no approved mapping: ${uncovered.map((f) => f.name).join(', ')}`, 'required_unmapped');
  }
}

function runMigration(project) {
  const database = db();
  const schema = JSON.parse(project.target_schema);
  const mappings = database.prepare('SELECT * FROM mappings WHERE project_id = ?').all(project.id);
  assertReady(project, schema, mappings);
  const rows = database.prepare('SELECT row_index, data FROM source_rows WHERE project_id = ? ORDER BY row_index').all(project.id);
  const started = Date.now();
  let loaded = 0;
  let failed = 0;
  database.transaction(() => {
    database.prepare('DELETE FROM target_rows WHERE project_id = ?').run(project.id);
    database.prepare('DELETE FROM issues WHERE project_id = ?').run(project.id);
    database.prepare('DELETE FROM reconciliations WHERE project_id = ?').run(project.id);
    const insert = database.prepare('INSERT INTO target_rows (project_id, row_index, data, errors, state) VALUES (?, ?, ?, ?, ?)');
    for (const row of rows) {
      const { data, errors } = buildTargetRow(schema, mappings, JSON.parse(row.data));
      const state = errors.length ? 'failed' : 'ok';
      if (state === 'ok') loaded++; else failed++;
      insert.run(project.id, row.row_index, JSON.stringify(data), JSON.stringify(errors), state);
    }
  })();
  setStatus(project.id, 'migrated');
  const result = { total: rows.length, loaded, failed };
  logger.info('migration.completed', { projectId: project.id, ...result, ms: Date.now() - started });
  return result;
}

module.exports = { runMigration, buildTargetRow, assertReady };
