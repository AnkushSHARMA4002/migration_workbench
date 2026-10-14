process.env.DB_PATH = ':memory:';
process.env.LOG_STDOUT = 'false';
process.env.SESSION_SECRET = 'test-secret';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');

let server;
let base;
let token;

async function call(method, url, body, auth = true) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

test('health is public and reports LLM status', async () => {
  const res = await call('GET', '/api/health', undefined, false);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.llm.configured, false);
});

test('protected routes reject anonymous requests and bad credentials', async () => {
  assert.strictEqual((await call('GET', '/api/projects', undefined, false)).status, 401);
  const bad = await call('POST', '/api/login', { email: 'reviewer@example.com', password: 'wrong' }, false);
  assert.strictEqual(bad.status, 401);
  const ok = await call('POST', '/api/login', { email: 'reviewer@example.com', password: 'Review@123' }, false);
  assert.strictEqual(ok.status, 200);
  token = ok.json.token;
});

test('project creation validates input', async () => {
  const short = await call('POST', '/api/projects', { name: 'x', sourceCsv: 'a,b\n1,2', targetSchema: [{ name: 'a' }] });
  assert.strictEqual(short.status, 400);
  const badCsv = await call('POST', '/api/projects', { name: 'Valid name', sourceCsv: 'a,b', targetSchema: [{ name: 'a' }] });
  assert.match(badCsv.json.error.message, /Source CSV/);
  const badSchema = await call('POST', '/api/projects', { name: 'Valid name', sourceCsv: 'a,b\n1,2', targetSchema: '[{"name":"a","type":"uuid"}]' });
  assert.match(badSchema.json.error.message, /unsupported type/);
  const badKey = await call('POST', '/api/projects', { name: 'Valid name', sourceCsv: 'a,b\n1,2', targetSchema: [{ name: 'a' }], keyField: 'zzz' });
  assert.match(badKey.json.error.message, /Key field/);
});

test('migration is blocked until every mapping is reviewed', async () => {
  const created = await call('POST', '/api/projects/sample');
  assert.strictEqual(created.status, 201);
  const id = created.json.id;
  const early = await call('POST', `/api/projects/${id}/migrate`);
  assert.strictEqual(early.status, 409);
  assert.strictEqual(early.json.error.code, 'plan_required');
  await call('POST', `/api/projects/${id}/plan`);
  const blocked = await call('POST', `/api/projects/${id}/migrate`);
  assert.strictEqual(blocked.status, 409);
  assert.strictEqual(blocked.json.error.code, 'review_required');
});

test('full workflow: plan, approve, migrate, reconcile, fix, re-reconcile, export', async () => {
  const id = (await call('POST', '/api/projects/sample')).json.id;
  const planned = await call('POST', `/api/projects/${id}/plan`);
  assert.strictEqual(planned.status, 200);
  assert.match(planned.json.project.plan.source, /heuristic/);
  assert.strictEqual(planned.json.project.mappings.length, 9);

  const bulk = await call('POST', `/api/projects/${id}/mappings/approve-confident`);
  assert.ok(bulk.json.approved >= 8);
  const rest = bulk.json.project.mappings.filter((m) => m.status === 'pending');
  for (const m of rest) await call('PATCH', `/api/mappings/${m.id}`, { decision: 'reject' });

  const migrated = await call('POST', `/api/projects/${id}/migrate`);
  assert.strictEqual(migrated.status, 200);
  assert.strictEqual(migrated.json.result.total, 20);
  assert.ok(migrated.json.result.failed >= 6);

  const rec = await call('POST', `/api/projects/${id}/reconcile`);
  assert.strictEqual(rec.status, 200);
  const kinds = rec.json.issues.map((i) => i.kind);
  assert.ok(kinds.includes('validation_failure'));
  assert.ok(kinds.includes('duplicate_key'));
  assert.ok(kinds.includes('unmapped_columns'));
  assert.strictEqual(rec.json.metrics.sourceRows, 20);

  const approveNoFix = await call('POST', `/api/issues/${rec.json.issues.find((i) => i.status === 'pending').id}/decision`, { decision: 'approve' });
  assert.strictEqual(approveNoFix.status, 409);
  assert.strictEqual(approveNoFix.json.error.code, 'no_fix');

  const proposed = await call('POST', `/api/projects/${id}/fixes/propose`);
  assert.ok(proposed.json.proposed > 0);
  assert.match(proposed.json.source, /heuristic/);

  const pending = proposed.json.issues.filter((i) => i.status === 'pending');
  const [first, ...others] = pending;
  const approved = await call('POST', `/api/issues/${first.id}/decision`, { decision: 'approve' });
  assert.strictEqual(approved.status, 200);
  assert.strictEqual(approved.json.status, 'applied');
  const again = await call('POST', `/api/issues/${first.id}/decision`, { decision: 'approve' });
  assert.strictEqual(again.status, 409);
  for (const i of others) {
    const r = await call('POST', `/api/issues/${i.id}/decision`, { decision: 'approve' });
    assert.strictEqual(r.status, 200);
  }

  const after = await call('POST', `/api/projects/${id}/reconcile`);
  assert.strictEqual(after.json.metrics.failed, 0);
  assert.strictEqual(after.json.issues.filter((i) => i.status === 'pending').length, 0);
  assert.strictEqual(after.json.metrics.loaded + after.json.metrics.excluded, 20);

  const exported = await call('GET', `/api/projects/${id}/export`);
  assert.strictEqual(exported.status, 200);
  assert.match(exported.text, /^customer_id,first_name,last_name,email/);
  assert.strictEqual(exported.text.trim().split('\n').length - 1, after.json.metrics.loaded);

  const logs = await call('GET', `/api/projects/${id}/logs`);
  const events = logs.json.logs.map((l) => l.event);
  for (const e of ['project.created', 'agent.plan.generated', 'migration.completed', 'reconciliation.completed', 'agent.fixes.proposed', 'fix.applied']) {
    assert.ok(events.includes(e), `missing log event ${e}`);
  }
});

test('users cannot read each other\'s projects', async () => {
  const id = (await call('POST', '/api/projects/sample')).json.id;
  const other = await call('POST', '/api/register', { email: 'someone@example.com', password: 'password123' }, false);
  assert.strictEqual(other.status, 201);
  const res = await fetch(`${base}/api/projects/${id}`, { headers: { Authorization: `Bearer ${other.json.token}` } });
  assert.strictEqual(res.status, 404);
});

test('mapping edits are validated', async () => {
  const id = (await call('POST', '/api/projects/sample')).json.id;
  const planned = await call('POST', `/api/projects/${id}/plan`);
  const m = planned.json.project.mappings[0];
  const badCol = await call('PATCH', `/api/mappings/${m.id}`, { sourceField: 'Nope' });
  assert.strictEqual(badCol.status, 400);
  const badTransform = await call('PATCH', `/api/mappings/${m.id}`, { transform: 'drop_table' });
  assert.strictEqual(badTransform.status, 400);
  const empty = await call('PATCH', `/api/mappings/${m.id}`, { sourceField: '', decision: 'approve' });
  assert.strictEqual(empty.status, 400);
});
