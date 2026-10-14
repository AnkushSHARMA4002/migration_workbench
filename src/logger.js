const db = require('./db');
const config = require('./config');

function write(level, event, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...meta };
  if (config.logStdout) process.stdout.write(JSON.stringify(entry) + '\n');
  try {
    const { projectId = null, ...rest } = meta;
    db().prepare('INSERT INTO logs (ts, level, event, project_id, meta) VALUES (?, ?, ?, ?, ?)')
      .run(entry.ts, level, event, projectId, JSON.stringify(rest));
  } catch (err) {
    process.stderr.write(JSON.stringify({ ts: entry.ts, level: 'error', event: 'logger.persist_failed', message: err.message }) + '\n');
  }
}

module.exports = {
  info: (event, meta) => write('info', event, meta),
  warn: (event, meta) => write('warn', event, meta),
  error: (event, meta) => write('error', event, meta)
};
