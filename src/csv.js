function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (inQuotes) throw new Error('Unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const filled = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (filled.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const headers = filled[0].map((h) => h.trim());
  if (headers.some((h) => h === '')) throw new Error('Header row contains an empty column name');
  const lower = headers.map((h) => h.toLowerCase());
  if (new Set(lower).size !== lower.length) throw new Error('Header row contains duplicate column names');
  const data = filled.slice(1).map((r, i) => {
    if (r.length > headers.length) throw new Error(`Data row ${i + 1} has more fields than the header`);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] === undefined ? '' : r[idx]; });
    return obj;
  });
  return { headers, rows: data };
}

function escapeField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(escapeField).join(',')];
  for (const r of rows) lines.push(headers.map((h) => escapeField(r[h])).join(','));
  return lines.join('\n') + '\n';
}

module.exports = { parseCsv, toCsv };
