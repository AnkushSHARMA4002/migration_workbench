process.env.DB_PATH = ':memory:';
process.env.LOG_STDOUT = 'false';
delete process.env.ANTHROPIC_API_KEY;

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('../src/csv');
const { heuristicPlan, validatePlan, generatePlan } = require('../src/planner');
const { validateFix, heuristicFix } = require('../src/fixes');
const { extractJson } = require('../src/llm');

const csv = fs.readFileSync(path.join(__dirname, '..', 'samples', 'legacy_customers.csv'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', 'target_schema.json'), 'utf8'));
const { headers } = parseCsv(csv);

test('heuristic planner maps the sample dataset sensibly', () => {
  const plan = heuristicPlan(headers, schema);
  const get = (name) => plan.mappings.find((m) => m.target_field === name);
  assert.strictEqual(get('customer_id').source_field, 'Cust ID');
  assert.strictEqual(get('email').source_field, 'E-mail Address');
  assert.strictEqual(get('phone').transform, 'phone_digits');
  assert.strictEqual(get('signup_date').transform, 'to_date_iso');
  assert.strictEqual(get('balance').source_field, 'Account Balance');
  assert.strictEqual(get('first_name').transform, 'first_word');
  assert.strictEqual(get('last_name').transform, 'last_word');
  assert.strictEqual(get('is_active').source_field, 'Is Active');
});

test('plan validation drops hallucinated columns, unknown transforms and unknown fields', () => {
  const raw = {
    summary: 'x',
    risks: ['r'],
    mappings: [
      { target_field: 'email', source_field: 'NoSuchColumn', transform: 'rm_rf', confidence: 5 },
      { target_field: 'ghost_field', source_field: 'Cust ID', transform: 'copy', confidence: 1 }
    ]
  };
  const plan = validatePlan(raw, headers, schema);
  assert.strictEqual(plan.mappings.length, schema.length);
  const email = plan.mappings.find((m) => m.target_field === 'email');
  assert.strictEqual(email.source_field, null);
  assert.strictEqual(email.transform, 'lower');
  assert.ok(!plan.mappings.some((m) => m.target_field === 'ghost_field'));
  assert.throws(() => validatePlan({ nothing: true }, headers, schema));
});

test('generatePlan falls back to heuristics when no LLM key is configured', async () => {
  const plan = await generatePlan({ projectId: null, columns: headers, sampleRows: [], schema });
  assert.match(plan.source, /heuristic/);
  assert.ok(plan.risks.some((r) => r.includes('Legacy Notes')));
});

test('fix validation blocks unsafe agent proposals', () => {
  const issue = { kind: 'validation_failure', field: 'customer_id', evidence: [] };
  assert.strictEqual(validateFix({ action: 'set_value', value: 'X' }, issue, schema, 'customer_id').action, 'none');
  const emailIssue = { kind: 'validation_failure', field: 'email', evidence: [] };
  assert.strictEqual(validateFix({ action: 'set_value', value: 'not-an-email' }, emailIssue, schema, 'customer_id').action, 'none');
  assert.strictEqual(validateFix({ action: 'set_value', value: 'a@b.co' }, emailIssue, schema, 'customer_id').action, 'set_value');
  assert.strictEqual(validateFix({ action: 'drop_database' }, emailIssue, schema, 'customer_id').action, 'none');
  assert.strictEqual(validateFix({ action: 'exclude_rows' }, emailIssue, schema, 'customer_id').action, 'exclude_rows');
});

test('heuristic fixes never invent missing required values', () => {
  const issue = { kind: 'validation_failure', field: 'email', evidence: [{ message: 'Required value is missing' }] };
  assert.strictEqual(heuristicFix(issue, schema).action, 'exclude_rows');
  const withDefault = schema.map((f) => (f.name === 'city' ? { ...f, default: 'Unknown' } : f));
  const cityIssue = { kind: 'validation_failure', field: 'city', evidence: [{ message: 'Required value is missing' }] };
  assert.strictEqual(heuristicFix(cityIssue, withDefault).action, 'set_value');
});

test('extractJson tolerates fences and surrounding prose', () => {
  assert.deepStrictEqual(extractJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json here'));
});
