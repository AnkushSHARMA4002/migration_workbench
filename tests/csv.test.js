const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, toCsv } = require('../src/csv');

test('parses quoted fields, escaped quotes, embedded newlines and BOM', () => {
  const text = '\uFEFFid,note\r\n1,"hello, world"\r\n2,"say ""hi"""\r\n3,"line1\nline2"\r\n';
  const { headers, rows } = parseCsv(text);
  assert.deepStrictEqual(headers, ['id', 'note']);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].note, 'hello, world');
  assert.strictEqual(rows[1].note, 'say "hi"');
  assert.strictEqual(rows[2].note, 'line1\nline2');
});

test('rejects malformed input with helpful messages', () => {
  assert.throws(() => parseCsv('a,b'), /header row and at least one data row/);
  assert.throws(() => parseCsv('a,a\n1,2'), /duplicate column names/);
  assert.throws(() => parseCsv('a,\n1,2'), /empty column name/);
  assert.throws(() => parseCsv('a,b\n"1,2'), /Unterminated/);
  assert.throws(() => parseCsv('a,b\n1,2,3'), /more fields/);
});

test('round trips through toCsv', () => {
  const out = toCsv(['a', 'b'], [{ a: 'x,y', b: 'q"r' }]);
  const back = parseCsv(out);
  assert.strictEqual(back.rows[0].a, 'x,y');
  assert.strictEqual(back.rows[0].b, 'q"r');
});
