const express = require('express');
const path = require('path');
const config = require('./config');
const db = require('./db');
const logger = require('./logger');
const auth = require('./auth');
const routes = require('./routes');
const { HttpError } = require('./errors');

function createApp() {
  db();
  auth.seedDemoUser();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '6mb' }));

  app.use('/api', (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      logger.info('http.request', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });

  app.use('/api', routes);
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Endpoint not found', 'not_found')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Request body is not valid JSON', 'validation');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Request is too large', 'too_large');
    const status = err.status || 500;
    if (status >= 500) logger.error('http.error', { path: req.originalUrl, message: err.message, stack: String(err.stack).split('\n').slice(0, 4).join(' | ') });
    else logger.warn('http.rejected', { path: req.originalUrl, status, code: err.code, message: err.message });
    res.status(status).json({ error: { message: status >= 500 ? 'Something went wrong on the server' : err.message, code: err.code || 'error' } });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    logger.info('server.started', { port: config.port, llm: require('./llm').describe() });
  });
}

module.exports = { createApp };
