const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const { HttpError } = require('./errors');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, salt, hash) {
  const candidate = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'));
  const expected = Buffer.from(hash);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function createUser(email, password) {
  const { salt, hash } = hashPassword(password);
  const info = db().prepare('INSERT INTO users (email, salt, hash, created_at) VALUES (?, ?, ?, ?)')
    .run(email, salt, hash, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function seedDemoUser() {
  const existing = db().prepare('SELECT id FROM users WHERE email = ?').get(config.demoEmail);
  if (!existing) createUser(config.demoEmail, config.demoPassword);
}

function login(email, password) {
  const user = db().prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password || ''), user.salt, user.hash)) {
    throw new HttpError(401, 'Email or password is incorrect', 'invalid_credentials');
  }
  return { token: sign({ uid: user.id, email: user.email, exp: Date.now() + TOKEN_TTL_MS }), email: user.email };
}

function register(email, password) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new HttpError(400, 'Enter a valid email address', 'validation');
  if (String(password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters', 'validation');
  if (db().prepare('SELECT id FROM users WHERE email = ?').get(clean)) {
    throw new HttpError(409, 'An account with this email already exists', 'conflict');
  }
  createUser(clean, password);
  return login(clean, password);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const payload = verify(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!payload) return next(new HttpError(401, 'Sign in to continue', 'unauthorized'));
  req.user = { id: payload.uid, email: payload.email };
  next();
}

module.exports = { login, register, requireAuth, seedDemoUser, sign, verify };
