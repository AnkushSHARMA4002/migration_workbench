const test = require('node:test');
const assert = require('node:assert');
const { applyTransform, coerce } = require('../src/transforms');

test('dates normalise to ISO and reject impossible dates', () => {
  assert.strictEqual(applyTransform('to_date_iso', '15/03/2021'), '2021-03-15');
  assert.strictEqual(applyTransform('to_date_iso', '2021-04-02'), '2021-04-02');
  assert.strictEqual(applyTransform('to_date_iso', 'Jan 5, 2020'), '2020-01-05');
  assert.strictEqual(applyTransform('to_date_iso', '12 Aug 2020'), '2020-08-12');
  assert.strictEqual(applyTransform('to_date_iso', '03/25/2021'), '2021-03-25');
  assert.throws(() => applyTransform('to_date_iso', '31/02/2021'), /Invalid calendar date/);
  assert.throws(() => applyTransform('to_date_iso', 'yesterday'), /Unrecognised date format/);
});

test('numbers strip currency and handle negatives in parentheses', () => {
  assert.strictEqual(applyTransform('to_number', '$1,250.50'), '1250.5');
  assert.strictEqual(applyTransform('to_number', 'Rs 12,000'), '12000');
  assert.strictEqual(applyTransform('to_number', '(200)'), '-200');
  assert.throws(() => applyTransform('to_number', 'N/A'), /Cannot read/);
  assert.strictEqual(applyTransform('to_number', '   '), '');
});

test('booleans, phones and name splitting', () => {
  assert.strictEqual(applyTransform('to_boolean', 'Y'), 'true');
  assert.strictEqual(applyTransform('to_boolean', 'inactive'), 'false');
  assert.throws(() => applyTransform('to_boolean', 'maybe'));
  assert.strictEqual(applyTransform('phone_digits', '+91 98765 43210'), '+919876543210');
  assert.throws(() => applyTransform('phone_digits', '12345'));
  assert.strictEqual(applyTransform('first_word', 'Aarav Kumar Sharma'), 'Aarav');
  assert.strictEqual(applyTransform('last_word', 'Aarav Kumar Sharma'), 'Sharma');
  assert.strictEqual(applyTransform('last_word', 'Madonna'), '');
});

test('unknown transforms are rejected', () => {
  assert.throws(() => applyTransform('eval', 'x'), /Unknown transform/);
});

test('coerce enforces target types', () => {
  assert.strictEqual(coerce('number', '12.5'), 12.5);
  assert.strictEqual(coerce('boolean', 'true'), true);
  assert.strictEqual(coerce('email', 'a@b.co'), 'a@b.co');
  assert.throws(() => coerce('email', 'kabir@example'));
  assert.throws(() => coerce('date', '2021-02-30'));
  assert.strictEqual(coerce('string', ''), '');
});
