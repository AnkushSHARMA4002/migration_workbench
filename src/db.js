const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  source_columns TEXT NOT NULL,
  target_schema TEXT NOT NULL,
  key_field TEXT,
  row_count INTEGER NOT NULL,
  plan_summary TEXT,
  plan_risks TEXT,
  plan_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_rows (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_rows_project ON source_rows(project_id, row_index);
CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_field TEXT NOT NULL,
  source_field TEXT,
  transform TEXT NOT NULL,
  default_value TEXT,
  confidence REAL NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mappings_project ON mappings(project_id);
CREATE TABLE IF NOT EXISTS target_rows (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  errors TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_target_rows_project ON target_rows(project_id, row_index);
CREATE TABLE IF NOT EXISTS reconciliations (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metrics TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  field TEXT,
  description TEXT NOT NULL,
  row_indexes TEXT NOT NULL,
  evidence TEXT NOT NULL,
  fix TEXT,
  fix_source TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  project_id INTEGER,
  meta TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_project ON logs(project_id, id);
`;

let instance = null;

function db() {
  if (instance) return instance;
  if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  instance = new Database(config.dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.exec(schema);
  return instance;
}

function close() {
  if (instance) instance.close();
  instance = null;
}

module.exports = db;
module.exports.close = close;
