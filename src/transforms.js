const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n) { return String(n).padStart(2, '0'); }

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isoDate(y, m, d, raw) {
  if (!validDate(y, m, d)) throw new Error(`Invalid calendar date "${raw}"`);
  return `${y}-${pad(m)}-${pad(d)}`;
}

function monthNumber(name) {
  const idx = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return idx === -1 ? null : idx + 1;
}

function toIsoDate(s) {
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3], s);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    return b > 12 ? isoDate(+m[3], a, b, s) : isoDate(+m[3], b, a, s);
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const mon = monthNumber(m[2]);
    if (mon) return isoDate(+m[3], mon, +m[1], s);
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = monthNumber(m[1]);
    if (mon) return isoDate(+m[3], mon, +m[2], s);
  }
  throw new Error(`Unrecognised date format "${s}"`);
}

function toNumberString(s) {
  let t = s.replace(/[\s,]/g, '').replace(/^[^\d\-(.]+/, '').replace(/[A-Za-z]+$/, '');
  let negative = false;
  if (/^\(.*\)$/.test(t)) { negative = true; t = t.slice(1, -1); }
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error(`Cannot read "${s}" as a number`);
  const n = Number(t);
  return String(negative ? -n : n);
}

const TRUE_VALUES = new Set(['yes', 'y', 'true', 't', '1', 'active']);
const FALSE_VALUES = new Set(['no', 'n', 'false', 'f', '0', 'inactive']);

const TRANSFORMS = {
  copy: (s) => s,
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, p, c) => p + c.toUpperCase()),
  to_number: toNumberString,
  to_integer: (s) => {
    const n = Number(toNumberString(s));
    if (!Number.isInteger(n)) throw new Error(`"${s}" is not a whole number`);
    return String(n);
  },
  to_date_iso: toIsoDate,
  to_boolean: (s) => {
    const k = s.toLowerCase();
    if (TRUE_VALUES.has(k)) return 'true';
    if (FALSE_VALUES.has(k)) return 'false';
    throw new Error(`Cannot read "${s}" as yes/no`);
  },
  phone_digits: (s) => {
    const plus = s.startsWith('+') ? '+' : '';
    const digits = s.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error(`"${s}" is not a valid phone number`);
    return plus + digits;
  },
  first_word: (s) => s.split(/\s+/)[0] || '',
  last_word: (s) => {
    const parts = s.split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }
};

const TRANSFORM_NAMES = Object.keys(TRANSFORMS);

function applyTransform(name, value) {
  const fn = TRANSFORMS[name];
  if (!fn) throw new Error(`Unknown transform "${name}"`);
  const input = value === null || value === undefined ? '' : String(value).trim();
  if (input === '') return '';
  return fn(input);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function coerce(type, value) {
  if (value === '' || value === null || value === undefined) return '';
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw new Error(`"${value}" is not a number`);
      return n;
    }
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isInteger(n)) throw new Error(`"${value}" is not a whole number`);
      return n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
      throw new Error(`"${value}" is not true or false`);
    }
    case 'date': {
      const s = String(value).trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) throw new Error(`"${value}" is not an ISO date (YYYY-MM-DD)`);
      return isoDate(+m[1], +m[2], +m[3], s);
    }
    case 'email': {
      const s = String(value).trim();
      if (!EMAIL_RE.test(s)) throw new Error(`"${value}" is not a valid email address`);
      return s;
    }
    default:
      return String(value);
  }
}

module.exports = { TRANSFORMS, TRANSFORM_NAMES, applyTransform, coerce };
