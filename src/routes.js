const express = require('express');
const db = require('./db');
const logger = require('./logger');
const llm = require('./llm');
const auth = require('./auth');
const { HttpError } = require('./errors');
const { toCsv } = require('./csv');
const { TRANSFORM_NAMES } = require('./transforms');
const projects = require('./projects');
const { generatePlan } = require('./planner');
const { runMigration } = require('./migrate');
const { runReconciliation, listIssues } = require('./reconcile');
const { proposeFixes, decideIssue } = require('./fixes');
const { loadSample } = require('./sample');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const loginHits = new Map();
function loginLimiter(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const recent = (loginHits.get(key) || []).filter((t) => now - t < 60000);
  if (recent.length >= 20) return next(new HttpError(429, 'Too many attempts. Wait a minute and try again', 'rate_limited'));
  recent.push(now);
  loginHits.set(key, recent);
  next();
}

function resetPlanArtifacts(projectId) {
  const database = db();
  database.prepare('DELETE FROM target_rows WHERE project_id = ?').run(projectId);
  database.prepare('DELETE FROM issues WHERE project_id = ?').run(projectId);
  database.prepare('DELETE FROM reconciliations WHERE project_id = ?').run(projectId);
}

function refreshPlanStatus(project) {
  const rows = db().prepare('SELECT status FROM mappings WHERE project_id = ?').all(project.id);
  if (!rows.length) return;
  const pending = rows.some((m) => m.status === 'pending');
  const approvedCount = rows.filter((m) => m.status === 'approved').length;
  const current = db().prepare('SELECT status FROM projects WHERE id = ?').get(project.id).status;
  if (['migrated', 'reconciled'].includes(current)) return;
  projects.setStatus(project.id, !pending && approvedCount > 0 ? 'approved' : 'planned');
}

const router = express.Router();

router.get('/health', (req, res) => {
  db().prepare('SELECT 1').get();
  res.json({ status: 'ok', llm: llm.describe() });
});

router.post('/login', loginLimiter, wrap((req, res) => {
  const result = auth.login(req.body.email, req.body.password);
  logger.info('auth.login', { email: result.email });
  res.json(result);
}));

router.post('/register', loginLimiter, wrap((req, res) => {
  const result = auth.register(req.body.email, req.body.password);
  logger.info('auth.register', { email: result.email });
  res.status(201).json(result);
}));

router.use(auth.requireAuth);

router.get('/me', (req, res) => {
  res.json({ email: req.user.email, llm: llm.describe(), transforms: TRANSFORM_NAMES });
});

router.get('/projects', (req, res) => {
  res.json({ projects: projects.listProjects(req.user.id) });
});

router.post('/projects', wrap((req, res) => {
  const id = projects.createProject(req.user.id, req.body || {});
  res.status(201).json({ id });
}));

router.post('/projects/sample', wrap((req, res) => {
  const id = projects.createProject(req.user.id, loadSample());
  res.status(201).json({ id });
}));

router.get('/projects/:id', wrap((req, res) => {
  res.json({ project: projects.serialize(projects.getProject(req.user.id, req.params.id)) });
}));

router.delete('/projects/:id', wrap((req, res) => {
  projects.deleteProject(req.user.id, req.params.id);
  res.json({ ok: true });
}));

router.post('/projects/:id/plan', wrap(async (req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const database = db();
  const columns = JSON.parse(project.source_columns);
  const schema = JSON.parse(project.target_schema);
  const sampleRows = database.prepare('SELECT data FROM source_rows WHERE project_id = ? ORDER BY row_index LIMIT 8').all(project.id).map((r) => JSON.parse(r.data));
  const started = Date.now();
  const plan = await generatePlan({ projectId: project.id, columns, sampleRows, schema });
  database.transaction(() => {
    database.prepare('DELETE FROM mappings WHERE project_id = ?').run(project.id);
    resetPlanArtifacts(project.id);
    const insert = database.prepare(
      'INSERT INTO mappings (project_id, target_field, source_field, transform, default_value, confidence, rationale, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const m of plan.mappings) insert.run(project.id, m.target_field, m.source_field, m.transform, m.default_value, m.confidence, m.rationale, 'pending');
    database.prepare('UPDATE projects SET plan_summary = ?, plan_risks = ?, plan_source = ? WHERE id = ?')
      .run(plan.summary, JSON.stringify(plan.risks), plan.source, project.id);
  })();
  projects.setStatus(project.id, 'planned');
  logger.info('agent.plan.generated', { projectId: project.id, mappings: plan.mappings.length, source: plan.source, ms: Date.now() - started });
  res.json({ project: projects.serialize(projects.getProject(req.user.id, project.id)) });
}));

router.patch('/mappings/:id', wrap((req, res) => {
  const database = db();
  const mapping = database.prepare('SELECT * FROM mappings WHERE id = ?').get(Number(req.params.id));
  if (!mapping) throw new HttpError(404, 'Mapping not found', 'not_found');
  const project = projects.getProject(req.user.id, mapping.project_id);
  const columns = JSON.parse(project.source_columns);
  const body = req.body || {};
  const next = { source_field: mapping.source_field, transform: mapping.transform, default_value: mapping.default_value, status: mapping.status, edited: mapping.edited };
  if ('sourceField' in body) {
    const value = body.sourceField === '' ? null : body.sourceField;
    if (value !== null && !columns.includes(value)) throw new HttpError(400, `Unknown source column "${value}"`, 'validation');
    next.source_field = value;
    next.edited = 1;
  }
  if ('transform' in body) {
    if (!TRANSFORM_NAMES.includes(body.transform)) throw new HttpError(400, `Unknown transform "${body.transform}"`, 'validation');
    next.transform = body.transform;
    next.edited = 1;
  }
  if ('defaultValue' in body) {
    const value = body.defaultValue === null ? '' : String(body.defaultValue);
    if (value.length > 200) throw new HttpError(400, 'Default value is limited to 200 characters', 'validation');
    next.default_value = value === '' ? null : value;
    next.edited = 1;
  }
  if (body.decision !== undefined) {
    if (!['approve', 'reject'].includes(body.decision)) throw new HttpError(400, 'Decision must be "approve" or "reject"', 'validation');
    if (body.decision === 'approve' && !next.source_field && !next.default_value) {
      throw new HttpError(400, 'Choose a source column or a default value before approving this mapping', 'validation');
    }
    next.status = body.decision === 'approve' ? 'approved' : 'rejected';
  } else if (next.edited && (mapping.status === 'approved' || mapping.status === 'rejected')) {
    next.status = 'pending';
  }
  database.prepare('UPDATE mappings SET source_field = ?, transform = ?, default_value = ?, status = ?, edited = ?, decided_at = ? WHERE id = ?')
    .run(next.source_field, next.transform, next.default_value, next.status, next.edited, new Date().toISOString(), mapping.id);
  if (['migrated', 'reconciled'].includes(project.status)) projects.setStatus(project.id, 'planned');
  refreshPlanStatus(project);
  logger.info('mapping.updated', { projectId: project.id, mappingId: mapping.id, targetField: mapping.target_field, status: next.status, edited: Boolean(next.edited) });
  res.json({ project: projects.serialize(projects.getProject(req.user.id, project.id)) });
}));

router.post('/projects/:id/mappings/approve-confident', wrap((req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const info = db().prepare(
    "UPDATE mappings SET status = 'approved', decided_at = ? WHERE project_id = ? AND status = 'pending' AND confidence >= 0.6 AND (source_field IS NOT NULL OR default_value IS NOT NULL)"
  ).run(new Date().toISOString(), project.id);
  refreshPlanStatus(project);
  logger.info('mapping.bulk_approved', { projectId: project.id, count: info.changes });
  res.json({ approved: info.changes, project: projects.serialize(projects.getProject(req.user.id, project.id)) });
}));

router.post('/projects/:id/migrate', wrap((req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const result = runMigration(project);
  res.json({ result, project: projects.serialize(projects.getProject(req.user.id, project.id)) });
}));

router.get('/projects/:id/target', wrap((req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const state = ['ok', 'failed', 'excluded'].includes(req.query.state) ? req.query.state : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const where = state ? 'WHERE project_id = ? AND state = ?' : 'WHERE project_id = ?';
  const args = state ? [project.id, state] : [project.id];
  const total = db().prepare(`SELECT COUNT(*) AS n FROM target_rows ${where}`).get(...args).n;
  const rows = db().prepare(`SELECT row_index, data, errors, state FROM target_rows ${where} ORDER BY row_index LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({
    total,
    rows: rows.map((r) => ({ rowIndex: r.row_index, state: r.state, data: JSON.parse(r.data), errors: JSON.parse(r.errors) }))
  });
}));

router.get('/projects/:id/export', wrap((req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const schema = JSON.parse(project.target_schema);
  const rows = db().prepare("SELECT data FROM target_rows WHERE project_id = ? AND state = 'ok' ORDER BY row_index").all(project.id);
  if (!rows.length) throw new HttpError(409, 'There are no loaded rows to export yet', 'nothing_to_export');
  logger.info('export.downloaded', { projectId: project.id, rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="migrated_project_${project.id}.csv"`);
  res.send(toCsv(schema.map((f) => f.name), rows.map((r) => JSON.parse(r.data))));
}));

router.post('/projects/:id/reconcile', wrap((req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const metrics = runReconciliation(project);
  res.json({ metrics, issues: listIssues(project.id), project: projects.serialize(projects.getProject(req.user.id, project.id)) });
}));

router.get('/projects/:id/issues', wrap((req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  res.json({ issues: listIssues(project.id) });
}));

router.post('/projects/:id/fixes/propose', wrap(async (req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const result = await proposeFixes(project);
  res.json({ ...result, issues: listIssues(project.id) });
}));

router.post('/issues/:id/decision', wrap((req, res) => {
  const row = db().prepare('SELECT project_id FROM issues WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Issue not found', 'not_found');
  const project = projects.getProject(req.user.id, row.project_id);
  const result = decideIssue(project, req.params.id, (req.body || {}).decision);
  res.json({ ...result, issues: listIssues(project.id), project: projects.serialize(projects.getProject(req.user.id, project.id)) });
}));

router.get('/projects/:id/logs', wrap((req, res) => {
  const project = projects.getProject(req.user.id, req.params.id);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const rows = db().prepare('SELECT id, ts, level, event, meta FROM logs WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(project.id, limit);
  res.json({ logs: rows.map((r) => ({ id: r.id, ts: r.ts, level: r.level, event: r.event, meta: JSON.parse(r.meta) })) });
}));

module.exports = router;
