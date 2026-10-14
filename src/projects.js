const db = require('./db');
const config = require('./config');
const logger = require('./logger');
const { HttpError } = require('./errors');
const { parseCsv } = require('./csv');
const { normalizeSchema } = require('./schema');

function createProject(userId, input) {
  const name = String(input.name || '').trim();
  if (name.length < 3 || name.length > 80) throw new HttpError(400, 'Project name must be 3 to 80 characters', 'validation');
  if (!String(input.sourceCsv || '').trim()) throw new HttpError(400, 'Add a source CSV file or paste CSV text', 'validation');
  let parsed;
  try {
    parsed = parseCsv(input.sourceCsv);
  } catch (err) {
    throw new HttpError(400, `Source CSV: ${err.message}`, 'validation');
  }
  if (parsed.rows.length > config.maxRows) {
    throw new HttpError(400, `Source CSV has ${parsed.rows.length} rows; the limit is ${config.maxRows}`, 'validation');
  }
  const schema = normalizeSchema(input.targetSchema);
  const keyField = input.keyField ? String(input.keyField).trim() : null;
  if (keyField && !schema.some((f) => f.name === keyField)) {
    throw new HttpError(400, `Key field "${keyField}" is not in the target schema`, 'validation');
  }
  const now = new Date().toISOString();
  const database = db();
  const id = database.transaction(() => {
    const info = database.prepare(
      'INSERT INTO projects (user_id, name, status, source_columns, target_schema, key_field, row_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, name, 'draft', JSON.stringify(parsed.headers), JSON.stringify(schema), keyField, parsed.rows.length, now, now);
    const projectId = Number(info.lastInsertRowid);
    const insert = database.prepare('INSERT INTO source_rows (project_id, row_index, data) VALUES (?, ?, ?)');
    parsed.rows.forEach((row, i) => insert.run(projectId, i + 1, JSON.stringify(row)));
    return projectId;
  })();
  logger.info('project.created', { projectId: id, userId, rows: parsed.rows.length, columns: parsed.headers.length, targetFields: schema.length });
  return id;
}

function getProject(userId, id) {
  const project = db().prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(Number(id), userId);
  if (!project) throw new HttpError(404, 'Project not found', 'not_found');
  return project;
}

function setStatus(projectId, status) {
  db().prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), projectId);
}

function serialize(project) {
  const database = db();
  const mappings = database.prepare('SELECT * FROM mappings WHERE project_id = ? ORDER BY id').all(project.id);
  const targetCounts = database.prepare('SELECT state, COUNT(*) AS n FROM target_rows WHERE project_id = ? GROUP BY state').all(project.id);
  const issueCounts = database.prepare('SELECT status, COUNT(*) AS n FROM issues WHERE project_id = ? GROUP BY status').all(project.id);
  const recon = database.prepare('SELECT * FROM reconciliations WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(project.id);
  const sample = database.prepare('SELECT row_index, data FROM source_rows WHERE project_id = ? ORDER BY row_index LIMIT 10').all(project.id);
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    keyField: project.key_field,
    rowCount: project.row_count,
    sourceColumns: JSON.parse(project.source_columns),
    targetSchema: JSON.parse(project.target_schema),
    plan: project.plan_summary === null ? null : {
      summary: project.plan_summary,
      risks: JSON.parse(project.plan_risks || '[]'),
      source: project.plan_source
    },
    mappings: mappings.map((m) => ({
      id: m.id,
      targetField: m.target_field,
      sourceField: m.source_field,
      transform: m.transform,
      defaultValue: m.default_value,
      confidence: m.confidence,
      rationale: m.rationale,
      status: m.status,
      edited: Boolean(m.edited)
    })),
    targetCounts: Object.fromEntries(targetCounts.map((r) => [r.state, r.n])),
    issueCounts: Object.fromEntries(issueCounts.map((r) => [r.status, r.n])),
    reconciliation: recon ? { ...JSON.parse(recon.metrics), id: recon.id } : null,
    sourceSample: sample.map((r) => ({ rowIndex: r.row_index, ...JSON.parse(r.data) })),
    createdAt: project.created_at,
    updatedAt: project.updated_at
  };
}

function listProjects(userId) {
  return db().prepare(
    'SELECT id, name, status, row_count, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY id DESC'
  ).all(userId).map((p) => ({ id: p.id, name: p.name, status: p.status, rowCount: p.row_count, createdAt: p.created_at, updatedAt: p.updated_at }));
}

function deleteProject(userId, id) {
  const project = getProject(userId, id);
  db().prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  logger.info('project.deleted', { projectId: project.id, userId });
}

module.exports = { createProject, getProject, setStatus, serialize, listProjects, deleteProject };
