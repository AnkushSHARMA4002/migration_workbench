const db = require('./db');
const logger = require('./logger');
const { HttpError } = require('./errors');
const { TRANSFORMS } = require('./transforms');
const { setStatus } = require('./projects');

const EMPTY_RATE_THRESHOLD = 0.3;

function round2(n) { return Math.round(n * 100) / 100; }

function sumSource(rows, column) {
  let total = 0;
  for (const row of rows) {
    const raw = String(row[column] === undefined ? '' : row[column]).trim();
    if (!raw) continue;
    try { total += Number(TRANSFORMS.to_number(raw)); } catch { continue; }
  }
  return total;
}

function analyse({ schema, columns, keyField, mappings, sourceRows, targetRows }) {
  const approved = mappings.filter((m) => m.status === 'approved');
  const counts = { ok: 0, failed: 0, excluded: 0 };
  for (const r of targetRows) counts[r.state] = (counts[r.state] || 0) + 1;
  const loadedRows = targetRows.filter((r) => r.state === 'ok');

  const fieldStats = {};
  for (const f of schema) {
    const empty = loadedRows.filter((r) => r.data[f.name] === '' || r.data[f.name] === undefined).length;
    fieldStats[f.name] = { required: f.required, filled: loadedRows.length - empty, empty };
  }

  const numericTotals = {};
  for (const f of schema.filter((x) => x.type === 'number' || x.type === 'integer')) {
    const m = approved.find((x) => x.target_field === f.name && x.source_field);
    if (!m) continue;
    const sourceTotal = sumSource(sourceRows.map((r) => r.data), m.source_field);
    const targetTotal = loadedRows.reduce((acc, r) => acc + (Number(r.data[f.name]) || 0), 0);
    numericTotals[f.name] = { sourceTotal: round2(sourceTotal), targetTotal: round2(targetTotal), gap: round2(sourceTotal - targetTotal) };
  }

  const used = new Set(approved.map((m) => m.source_field).filter(Boolean));
  const unmappedColumns = columns.filter((c) => !used.has(c));

  const issues = [];
  const groups = new Map();
  for (const r of targetRows.filter((x) => x.state === 'failed')) {
    for (const e of r.errors) {
      const category = e.message === 'Required value is missing' ? 'missing' : 'invalid';
      const key = `${e.field}|${category}`;
      if (!groups.has(key)) groups.set(key, { field: e.field, category, rows: [], evidence: [] });
      const g = groups.get(key);
      g.rows.push(r.row_index);
      if (g.evidence.length < 3) g.evidence.push({ rowIndex: r.row_index, raw: e.raw, message: e.message });
    }
  }
  for (const g of groups.values()) {
    issues.push({
      kind: 'validation_failure',
      severity: g.category === 'missing' ? 'high' : 'medium',
      field: g.field,
      description: g.category === 'missing'
        ? `${g.rows.length} row(s) have no value for required field "${g.field}"`
        : `${g.rows.length} row(s) have values in "${g.field}" that could not be converted`,
      rowIndexes: g.rows,
      evidence: g.evidence,
      status: 'pending'
    });
  }

  if (keyField) {
    const seen = new Map();
    const dupRows = [];
    const evidence = [];
    for (const r of loadedRows) {
      const key = String(r.data[keyField]).trim().toLowerCase();
      if (key === '') continue;
      if (seen.has(key)) {
        dupRows.push(r.row_index);
        if (evidence.length < 3) evidence.push({ rowIndex: r.row_index, raw: String(r.data[keyField]), message: `Duplicates row ${seen.get(key)}` });
      } else seen.set(key, r.row_index);
    }
    if (dupRows.length) {
      issues.push({
        kind: 'duplicate_key',
        severity: 'high',
        field: keyField,
        description: `${dupRows.length} row(s) repeat a "${keyField}" value already loaded`,
        rowIndexes: dupRows,
        evidence,
        status: 'pending'
      });
    }
  }

  if (unmappedColumns.length) {
    issues.push({
      kind: 'unmapped_columns',
      severity: 'low',
      field: null,
      description: `Source columns not migrated: ${unmappedColumns.join(', ')}`,
      rowIndexes: [],
      evidence: [],
      status: 'info'
    });
  }

  for (const f of schema.filter((x) => !x.required)) {
    const stat = fieldStats[f.name];
    const total = stat.filled + stat.empty;
    if (total > 0 && stat.empty / total > EMPTY_RATE_THRESHOLD) {
      issues.push({
        kind: 'high_empty_rate',
        severity: 'low',
        field: f.name,
        description: `"${f.name}" is empty in ${stat.empty} of ${total} loaded rows`,
        rowIndexes: [],
        evidence: [],
        status: 'info'
      });
    }
  }

  const unaccounted = sourceRows.length - targetRows.length;
  if (unaccounted !== 0) {
    issues.push({
      kind: 'count_mismatch',
      severity: 'high',
      field: null,
      description: `${Math.abs(unaccounted)} source row(s) have no matching target record`,
      rowIndexes: [],
      evidence: [],
      status: 'info'
    });
  }

  const metrics = {
    sourceRows: sourceRows.length,
    loaded: counts.ok,
    failed: counts.failed,
    excluded: counts.excluded,
    unaccounted,
    duplicateKeyRows: issues.filter((i) => i.kind === 'duplicate_key').reduce((a, i) => a + i.rowIndexes.length, 0),
    fieldStats,
    numericTotals,
    unmappedColumns,
    generatedAt: new Date().toISOString()
  };
  return { metrics, issues };
}

function loadInputs(project) {
  const database = db();
  return {
    schema: JSON.parse(project.target_schema),
    columns: JSON.parse(project.source_columns),
    keyField: project.key_field,
    mappings: database.prepare('SELECT * FROM mappings WHERE project_id = ?').all(project.id),
    sourceRows: database.prepare('SELECT row_index, data FROM source_rows WHERE project_id = ? ORDER BY row_index').all(project.id)
      .map((r) => ({ row_index: r.row_index, data: JSON.parse(r.data) })),
    targetRows: database.prepare('SELECT row_index, data, errors, state FROM target_rows WHERE project_id = ? ORDER BY row_index').all(project.id)
      .map((r) => ({ row_index: r.row_index, data: JSON.parse(r.data), errors: JSON.parse(r.errors), state: r.state }))
  };
}

function runReconciliation(project) {
  const database = db();
  const inputs = loadInputs(project);
  if (!inputs.targetRows.length) throw new HttpError(409, 'Run the migration before reconciling', 'migration_required');
  const { metrics, issues } = analyse(inputs);
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("DELETE FROM issues WHERE project_id = ? AND status IN ('pending', 'info')").run(project.id);
    const insert = database.prepare(
      'INSERT INTO issues (project_id, kind, severity, field, description, row_indexes, evidence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const i of issues) insert.run(project.id, i.kind, i.severity, i.field, i.description, JSON.stringify(i.rowIndexes), JSON.stringify(i.evidence), i.status, now);
    database.prepare('INSERT INTO reconciliations (project_id, metrics, created_at) VALUES (?, ?, ?)').run(project.id, JSON.stringify(metrics), now);
  })();
  setStatus(project.id, 'reconciled');
  logger.info('reconciliation.completed', {
    projectId: project.id,
    sourceRows: metrics.sourceRows,
    loaded: metrics.loaded,
    failed: metrics.failed,
    excluded: metrics.excluded,
    issues: issues.length,
    actionable: issues.filter((i) => i.status === 'pending').length
  });
  return metrics;
}

function listIssues(projectId) {
  return db().prepare('SELECT * FROM issues WHERE project_id = ? ORDER BY id').all(projectId).map((i) => ({
    id: i.id,
    kind: i.kind,
    severity: i.severity,
    field: i.field,
    description: i.description,
    rowIndexes: JSON.parse(i.row_indexes),
    evidence: JSON.parse(i.evidence),
    fix: i.fix ? JSON.parse(i.fix) : null,
    fixSource: i.fix_source,
    status: i.status,
    decidedAt: i.decided_at
  }));
}

module.exports = { runReconciliation, analyse, listIssues };
